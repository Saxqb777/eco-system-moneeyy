import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { budgetLedger, floors, revenue } from "@/db/schema";
import { dubaiDayStartUtc } from "@/lib/time";
import { asNumber, getSettings } from "@/lib/settings";

export interface SpendSummary {
  todayUsd: number;
  todayByFloor: Record<string, number>;
  netUsd: number;
  verifiedRevenueUsd: number;
  totalSpendUsd: number;
}

// Real money only unless simulated is true. Simulated rows never mix with real counters.
export async function getSpendSummary(db: Db, simulated: boolean, now = new Date()): Promise<SpendSummary> {
  const dayStart = dubaiDayStartUtc(now);
  const costKinds = ["api_cost", "web_search"];

  const todayRows = await db
    .select({ floorId: budgetLedger.floorId, total: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.simulated, simulated), inArray(budgetLedger.kind, costKinds), gte(budgetLedger.occurredAt, dayStart)))
    .groupBy(budgetLedger.floorId);

  const todayByFloor: Record<string, number> = {};
  let todayUsd = 0;
  for (const r of todayRows) {
    const v = Number(r.total);
    todayUsd += v;
    todayByFloor[r.floorId ?? "none"] = v;
  }

  const [spendAll] = await db
    .select({ total: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.simulated, simulated), inArray(budgetLedger.kind, costKinds)));

  const [rev] = await db
    .select({ total: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
    .from(revenue)
    .where(and(eq(revenue.simulated, simulated), eq(revenue.verified, true)));

  const totalSpendUsd = Number(spendAll?.total ?? 0);
  const verifiedRevenueUsd = Number(rev?.total ?? 0);
  return { todayUsd, todayByFloor, netUsd: verifiedRevenueUsd - totalSpendUsd, verifiedRevenueUsd, totalSpendUsd };
}

export interface GuardResult {
  capUsd: number;
  todayUsd: number;
  capHit: boolean;
  throttledFloors: string[];
  pausedFloors: string[];
}

// The share of the daily cap one business floor may use alone (D065): settings.floor_share per slug, 40 percent otherwise.
export function floorShare(settingsMap: Record<string, unknown>, slug: string): number {
  const shares = (settingsMap.floor_share ?? {}) as Record<string, unknown>;
  const v = Number(shares[slug]);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.4;
}

// Rule 2: never exceed the daily cap. Rule from the brief: throttle any floor above its share alone.
export async function guardSpend(db: Db, now = new Date()): Promise<GuardResult> {
  const s = await getSettings(db);
  const capUsd = asNumber(s.daily_cap_usd, 1.7);
  const summary = await getSpendSummary(db, false, now);
  const liveFloors = await db.select().from(floors).where(eq(floors.status, "live"));
  const throttled: string[] = [];
  const paused: string[] = [];
  const dayEnd = new Date(dubaiDayStartUtc(now).getTime() + 24 * 60 * 60 * 1000);

  for (const f of liveFloors) {
    const spent = summary.todayByFloor[f.id] ?? 0;
    if (f.isBusiness && spent > capUsd * floorShare(s, f.slug)) {
      throttled.push(f.slug);
      await db.update(floors).set({ throttledUntil: dayEnd, updatedAt: now }).where(eq(floors.id, f.id));
    }
  }

  const capHit = summary.todayUsd >= capUsd;
  if (capHit) {
    for (const f of liveFloors) {
      if (!f.isBusiness) continue;
      paused.push(f.slug);
      await db
        .update(floors)
        .set({ status: "paused", pausedReason: `Daily cap of ${capUsd.toFixed(2)} USD reached`, updatedAt: now })
        .where(eq(floors.id, f.id));
    }
  }
  return { capUsd, todayUsd: summary.todayUsd, capHit, throttledFloors: throttled, pausedFloors: paused };
}

// Budget level review, every 7 days from launch (question 16). Verified revenue only, real rows only.
export interface BudgetReviewResult {
  status: "skipped" | "raised" | "held" | "dropped" | "needs_approval";
  reason?: string;
  weekStart?: string;
  spendUsd?: number;
  revenueUsd?: number;
  levelAfter?: number;
  capAfter?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_CAP = 1.7;

export async function ensureLaunchDate(db: Db, now = new Date()): Promise<Date> {
  const s = await getSettings(db);
  const raw = s.launch_date as string | null;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const { setSetting } = await import("@/lib/settings");
  await setSetting(db, "launch_date", now.toISOString());
  return now;
}

export async function reviewBudget(db: Db, now = new Date()): Promise<BudgetReviewResult> {
  const s = await getSettings(db);
  const raw = s.launch_date as string | null;
  if (!raw) return { status: "skipped", reason: "no launch date yet (set when simulation is switched off)" };
  const launch = new Date(raw);
  const weeks = Math.floor((now.getTime() - launch.getTime()) / (7 * DAY_MS));
  if (weeks < 1) return { status: "skipped", reason: "first review comes 7 days after launch" };
  const periodStart = new Date(launch.getTime() + (weeks - 1) * 7 * DAY_MS);
  const periodEnd = new Date(launch.getTime() + weeks * 7 * DAY_MS);
  const weekStart = periodStart.toISOString().slice(0, 10);
  const { budgetReviews } = await import("@/db/schema");
  const { desc, lt } = await import("drizzle-orm");
  const [done] = await db.select({ id: budgetReviews.id }).from(budgetReviews).where(eq(budgetReviews.weekStart, weekStart)).limit(1);
  if (done) return { status: "skipped", reason: "this week is reviewed", weekStart };

  const [spendRow] = await db
    .select({ t: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.simulated, false), inArray(budgetLedger.kind, ["api_cost", "web_search"]), gte(budgetLedger.occurredAt, periodStart), lt(budgetLedger.occurredAt, periodEnd)));
  const [revRow] = await db
    .select({ t: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
    .from(revenue)
    .where(and(eq(revenue.simulated, false), eq(revenue.verified, true), gte(revenue.occurredAt, periodStart), lt(revenue.occurredAt, periodEnd)));
  const spendUsd = Number(spendRow?.t ?? 0);
  const revenueUsd = Number(revRow?.t ?? 0);
  const ratio = spendUsd > 0 ? revenueUsd / spendUsd : revenueUsd > 0 ? 99 : 0;
  const [previous] = await db.select().from(budgetReviews).orderBy(desc(budgetReviews.createdAt)).limit(1);
  const lowWeeks = ratio < 1 ? (previous?.consecutiveLowWeeks ?? 0) + 1 : 0;

  const level = asNumber(s.budget_level, 1);
  const cap = asNumber(s.daily_cap_usd, BASE_CAP);
  const ceiling = asNumber(s.hard_ceiling_usd, 5);
  let decision: BudgetReviewResult["status"] = "held";
  let levelAfter = level;
  let capAfter = cap;
  let approvalId: string | null = null;
  const { setSetting } = await import("@/lib/settings");
  const { enqueueMessage } = await import("@/lib/telegram");

  if (spendUsd > 0 && ratio >= 2) {
    const proposed = Math.round(cap * 1.25 * 100) / 100;
    if (proposed <= ceiling) {
      decision = "raised";
      levelAfter = level + 1;
      capAfter = proposed;
      await setSetting(db, "budget_level", levelAfter);
      await setSetting(db, "daily_cap_usd", capAfter);
    } else {
      decision = "needs_approval";
      const { raiseApproval } = await import("@/lib/approvals");
      const raised = await raiseApproval(db, {
        type: "spend_increase",
        summary: `Raise the daily cap to ${proposed.toFixed(2)} USD, past the ${ceiling.toFixed(2)} USD ceiling`,
        content: { proposedCapUsd: proposed, proposedCeilingUsd: proposed, weekStart, spendUsd, revenueUsd },
        riskNote: `Verified revenue ${revenueUsd.toFixed(2)} USD against ${spendUsd.toFixed(2)} USD spend this week. Approving raises the ceiling and the cap.`,
      }, now);
      approvalId = raised.id;
    }
  } else if (lowWeeks >= 2 && level > 1) {
    decision = "dropped";
    levelAfter = level - 1;
    capAfter = Math.max(BASE_CAP, Math.round((cap / 1.25) * 100) / 100);
    await setSetting(db, "budget_level", levelAfter);
    await setSetting(db, "daily_cap_usd", capAfter);
  }

  await db.insert(budgetReviews).values({
    weekStart,
    spendUsd: spendUsd.toFixed(6),
    verifiedRevenueUsd: revenueUsd.toFixed(6),
    ratio: Number.isFinite(ratio) ? ratio.toFixed(4) : null,
    decision,
    levelBefore: level,
    levelAfter,
    capBefore: cap.toFixed(6),
    capAfter: capAfter.toFixed(6),
    approvalId,
    consecutiveLowWeeks: decision === "dropped" ? 0 : lowWeeks,
    createdAt: now,
  });
  const line =
    decision === "raised"
      ? `Budget review: revenue ${revenueUsd.toFixed(2)} USD against spend ${spendUsd.toFixed(2)} USD. Level ${level} to ${levelAfter}, daily cap now ${capAfter.toFixed(2)} USD.`
      : decision === "dropped"
        ? `Budget review: revenue below spend for ${lowWeeks} weeks. Level ${level} to ${levelAfter}, daily cap now ${capAfter.toFixed(2)} USD.`
        : decision === "needs_approval"
          ? `Budget review: the floors earned their raise but the next cap passes the ceiling. An approval item is on the red phone.`
          : `Budget review: revenue ${revenueUsd.toFixed(2)} USD against spend ${spendUsd.toFixed(2)} USD. Level stays at ${level}.`;
  await enqueueMessage(db, { kind: "budget_review", body: line, now });
  return { status: decision, weekStart, spendUsd, revenueUsd, levelAfter, capAfter };
}
