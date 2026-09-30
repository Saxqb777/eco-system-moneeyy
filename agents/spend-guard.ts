// Rule 2 for work that has not been billed yet. A batch task costs nothing on the ledger until its result comes
// back, so the guard reserves an estimate for every task and Warden run still in flight. Without the reserve,
// one tick after another saw an empty ledger and filled the day past the cap (2026-09-30: 1.86 against 1.70).
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { tasks, wardenRuns } from "@/db/schema";
import { getSpendSummary } from "@/lib/budget";
import { asNumber, getSettings } from "@/lib/settings";
import { playbookFor } from "./playbooks";

// Averages seen in production on 2026-09-30, rounded up: research with web tools 0.04 to 0.09, writing 0.01 to 0.02.
export const RESEARCH_TASK_USD = 0.08;
export const WRITING_TASK_USD = 0.03;
export const WARDEN_RUN_USD = 0.12;
// A batch that never came back stops holding budget after a day, when the Batch API gives up on it too.
const IN_FLIGHT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Research reads pages or searches several times; a writer's one or two look ups stay in the writing estimate.
export function estimateTaskUsd(kind: string): number {
  const p = playbookFor(kind);
  return p && ((p.webFetchMaxUses ?? 0) > 0 || (p.webSearchMaxUses ?? 0) >= 3) ? RESEARCH_TASK_USD : WRITING_TASK_USD;
}

// Estimated cost of real work already started but not yet on the ledger, in total and per floor.
export async function inFlightUsd(db: Db, now = new Date()): Promise<{ totalUsd: number; byFloor: Record<string, number> }> {
  const since = new Date(now.getTime() - IN_FLIGHT_WINDOW_MS);
  const running = await db
    .select({ kind: tasks.kind, floorId: tasks.floorId })
    .from(tasks)
    .where(and(eq(tasks.status, "running"), eq(tasks.simulated, false), gte(tasks.startedAt, since)));
  const byFloor: Record<string, number> = {};
  let totalUsd = 0;
  for (const t of running) {
    const usd = estimateTaskUsd(t.kind);
    totalUsd += usd;
    const key = t.floorId ?? "none";
    byFloor[key] = (byFloor[key] ?? 0) + usd;
  }
  const wardens = await db
    .select({ id: wardenRuns.id })
    .from(wardenRuns)
    .where(and(eq(wardenRuns.status, "submitted"), eq(wardenRuns.simulated, false), gte(wardenRuns.startedAt, since)));
  totalUsd += wardens.length * WARDEN_RUN_USD;
  return { totalUsd, byFloor };
}

// What is left of today's cap once billed spend and the work in flight are counted.
export async function budgetLeftUsd(db: Db, now = new Date()): Promise<{ capUsd: number; spentUsd: number; reservedUsd: number; leftUsd: number }> {
  const s = await getSettings(db);
  const capUsd = asNumber(s.daily_cap_usd, 1.7);
  const spend = await getSpendSummary(db, false, now);
  const reserved = await inFlightUsd(db, now);
  return { capUsd, spentUsd: spend.todayUsd, reservedUsd: reserved.totalUsd, leftUsd: capUsd - spend.todayUsd - reserved.totalUsd };
}
