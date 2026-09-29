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

// Rule 2: never exceed the daily cap. Rule from the brief: throttle any floor above 40 percent alone.
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
    if (f.isBusiness && spent > capUsd * 0.4) {
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
