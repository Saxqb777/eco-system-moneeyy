// The morning brief, built from data so it reads as Warden without a model call.
// Phase 3 shows it in the Warden panel. Phase 4 sends the same lines to Telegram at 08:00 Dubai.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, approvals, budgetLedger, floors, revenue, setupItems, tasks, wardenRuns } from "@/db/schema";
import { FLOOR_REQUIREMENTS } from "@/config/tower";
import { salesFunnel } from "@/agents/docledger-autonomy";
import { channelHealthFrom } from "@/lib/channel";
import { asBool, getSettings } from "@/lib/settings";
import { dubaiDayStartUtc, dubaiParts } from "@/lib/time";

export interface Brief {
  dayKey: string;
  simulated: boolean;
  moneyInTodayUsd: number;
  moneyOutTodayUsd: number;
  netTodayUsd: number;
  netTotalUsd: number;
  needs: string[];
  floors: Array<{ slug: string; name: string; level: number; line: string }>;
  notes: string[];
}

const COST_KINDS = ["api_cost", "web_search"];

function usd(n: number): string {
  return `${n.toFixed(2)} USD`;
}

export async function buildBrief(db: Db, now = new Date()): Promise<Brief> {
  const settingsMap = await getSettings(db);
  const simulated = asBool(settingsMap.simulation_mode, true);
  const dayStart = dubaiDayStartUtc(now);
  const parts = dubaiParts(now);

  const [inToday] = await db
    .select({ t: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
    .from(revenue)
    .where(and(eq(revenue.simulated, simulated), eq(revenue.verified, true), gte(revenue.occurredAt, dayStart)));
  const [inTotal] = await db
    .select({ t: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
    .from(revenue)
    .where(and(eq(revenue.simulated, simulated), eq(revenue.verified, true)));
  const spendRows = await db
    .select({ floorId: budgetLedger.floorId, today: sql<string>`coalesce(sum(case when ${budgetLedger.occurredAt} >= ${dayStart} then ${budgetLedger.amountUsd} else 0 end), 0)`, total: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.simulated, simulated), inArray(budgetLedger.kind, COST_KINDS)))
    .groupBy(budgetLedger.floorId);
  const spendToday = new Map<string, number>();
  let outToday = 0;
  let outTotal = 0;
  for (const r of spendRows) {
    spendToday.set(r.floorId ?? "", Number(r.today));
    outToday += Number(r.today);
    outTotal += Number(r.total);
  }
  const revRows = await db
    .select({ floorId: revenue.floorId, today: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
    .from(revenue)
    .where(and(eq(revenue.simulated, simulated), eq(revenue.verified, true), gte(revenue.occurredAt, dayStart)))
    .groupBy(revenue.floorId);
  const revToday = new Map(revRows.map((r) => [r.floorId ?? "", Number(r.today)]));

  const floorRows = await db.select().from(floors).orderBy(desc(floors.level));
  const agentRows = await db.select().from(agents);
  const doneRows = await db
    .select({ floorId: tasks.floorId, n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.simulated, simulated), eq(tasks.status, "done"), gte(tasks.finishedAt, dayStart)))
    .groupBy(tasks.floorId);
  const doneToday = new Map(doneRows.map((r) => [r.floorId ?? "", Number(r.n)]));
  const blockedRows = await db.select().from(tasks).where(and(eq(tasks.simulated, simulated), eq(tasks.status, "blocked")));
  const [pending] = await db.select({ n: sql<string>`count(*)` }).from(approvals).where(and(eq(approvals.status, "pending"), eq(approvals.simulated, simulated)));
  const setupRows = await db.select().from(setupItems);
  const present = new Set(setupRows.filter((s) => s.status === "present").map((s) => s.key));
  const labelByKey = new Map(setupRows.map((s) => [s.key, s.label]));
  const runs = await db.select().from(wardenRuns).where(eq(wardenRuns.simulated, simulated)).orderBy(desc(wardenRuns.startedAt)).limit(3);

  const needs: string[] = [];
  const pendingCount = Number(pending?.n ?? 0);
  if (pendingCount > 0) needs.push(`${pendingCount} approval${pendingCount === 1 ? "" : "s"} waiting on the red phone`);
  for (const t of blockedRows) {
    const a = agentRows.find((x) => x.id === t.agentId);
    const f = floorRows.find((x) => x.id === t.floorId);
    needs.push(`${a?.name ?? "A worker"} on ${f?.name ?? "a floor"} is blocked: ${t.blockedReason ?? "no reason recorded"}`);
  }
  for (const f of floorRows) {
    if (f.status !== "live") continue;
    const missing = (FLOOR_REQUIREMENTS[f.slug] ?? []).filter((k) => !present.has(k));
    if (missing.length) needs.push(`${f.name} runs simulated until you paste: ${missing.map((k) => labelByKey.get(k) ?? k).join(", ")}`);
  }
  if (!present.has("anthropic_api_key")) needs.push("Anthropic API key: the building stays in simulation until it is on the clipboard");
  const channel = channelHealthFrom(settingsMap, parts.dayKey);
  const funnel = simulated ? null : await salesFunnel(db, now);
  if (funnel && funnel.hotOpen > 0) needs.push(`${funnel.hotOpen} hot DocLedger lead${funnel.hotOpen === 1 ? "" : "s"} waiting for you to close`);
  const botName = (settingsMap.telegram_bot as { username?: string } | null)?.username;
  if (!simulated && channel.botCanPost === false) needs.push(`The bot${botName ? ` @${botName}` : ""} cannot post in the deals channel: make it an admin with Post messages`);

  const floorLines = floorRows.map((f) => {
    const crew = agentRows.filter((a) => a.floorId === f.id && a.kind !== "warden");
    let line: string;
    if (f.status === "locked") line = f.unlockRule ?? "Locked";
    else if (f.status === "paused") line = `Paused: ${f.pausedReason ?? "by the owner"}`;
    else if (f.slug === "penthouse") line = `Warden at the desk, ${runs.length ? `last run ${runs[0]?.summary ?? "done"}` : "no runs yet"}`;
    else if (f.slug === "lobby") line = `Petty cash ${usd(Number(inTotal?.t ?? 0) - outTotal)} in the drawer`;
    else {
      const blocked = crew.filter((a) => a.status === "blocked").length;
      const working = crew.filter((a) => a.status === "working").length;
      const bits = [`${doneToday.get(f.id) ?? 0} done today`, `${working} at work`];
      if (blocked) bits.push(`${blocked} blocked`);
      bits.push(`spent ${usd(spendToday.get(f.id) ?? 0)}`);
      const rev = revToday.get(f.id) ?? 0;
      if (rev > 0) bits.push(`earned ${usd(rev)}`);
      if (f.slug === "docledger" && !simulated && funnel) {
        const bitsSales = [`${funnel.leadsWeek} leads, ${funnel.sentWeek} sent, ${funnel.repliesWeek} replies this week`];
        if (funnel.demosWeek) bitsSales.push(`${funnel.demosWeek} demo${funnel.demosWeek === 1 ? "" : "s"} booked`);
        bitsSales.push(funnel.autoSend ? `${funnel.autoSentToday} sent on their own today` : `auto send after ${Math.max(0, 10 - funnel.trustApprovedInARow)} more approvals`);
        bits.unshift(...bitsSales);
      }
      if (f.slug === "deals" && !simulated && channel.members !== null) {
        const week = channel.growthWeek;
        bits.unshift(`channel ${channel.members} members${week !== null ? ` (${week >= 0 ? "+" : ""}${week} this week)` : ""}`);
      }
      if (f.strategyNote) bits.push(`note: ${f.strategyNote}`);
      line = bits.join(", ");
    }
    return { slug: f.slug, name: f.name, level: f.level, line };
  });

  const inTodayUsd = Number(inToday?.t ?? 0);
  return {
    dayKey: parts.dayKey,
    simulated,
    moneyInTodayUsd: inTodayUsd,
    moneyOutTodayUsd: outToday,
    netTodayUsd: inTodayUsd - outToday,
    netTotalUsd: Number(inTotal?.t ?? 0) - outTotal,
    needs,
    floors: floorLines,
    notes: runs.map((r) => r.summary).filter((s): s is string => !!s),
  };
}

// Plain text for Telegram. No markup, so nothing needs escaping.
export function formatBrief(b: Brief): string {
  const lines: string[] = [];
  lines.push(`Morning brief, ${b.dayKey}${b.simulated ? " (SIMULATED)" : ""}`);
  lines.push(`Money in today: ${usd(b.moneyInTodayUsd)}`);
  lines.push(`Money out today: ${usd(b.moneyOutTodayUsd)}`);
  lines.push(`Net today: ${usd(b.netTodayUsd)}. Net all time: ${usd(b.netTotalUsd)}`);
  lines.push("");
  lines.push(b.needs.length ? "Needs you:" : "Needs you: nothing today.");
  for (const n of b.needs) lines.push(`• ${n}`);
  lines.push("");
  lines.push("Floors:");
  for (const f of b.floors) lines.push(`• ${f.name}: ${f.line}`);
  if (b.notes.length) {
    lines.push("");
    lines.push(`Warden: ${b.notes[0]}`);
  }
  return lines.join("\n");
}
