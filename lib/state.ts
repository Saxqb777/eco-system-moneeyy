import { and, desc, eq, inArray } from "drizzle-orm";
import { FLOOR_REQUIREMENTS } from "@/config/tower";
import type { Db } from "@/db/client";
import { agents, approvals, floors, setupItems, taskEvents, tasks, ticks } from "@/db/schema";
import { getSpendSummary } from "@/lib/budget";
import { asBool, asNumber, getSettings } from "@/lib/settings";
import { dubaiParts, isNightInDubai } from "@/lib/time";

export interface TowerState {
  now: string;
  dubai: { dayKey: string; hour: number; minute: number; night: boolean };
  simulationMode: boolean;
  budget: { level: number; dailyCapUsd: number; hardCeilingUsd: number };
  money: {
    real: { netUsd: number; spendTodayUsd: number; verifiedRevenueUsd: number; totalSpendUsd: number };
    simulated: { netUsd: number; spendTodayUsd: number; verifiedRevenueUsd: number; totalSpendUsd: number };
  };
  floors: Array<{
    id: string;
    slug: string;
    name: string;
    level: number;
    accent: string;
    status: string;
    goalMetric: string;
    weeklyTarget: number;
    targetUnit: string;
    unlockRule: string | null;
    strategyNote: string | null;
    pausedReason: string | null;
    throttled: boolean;
    behindTarget: boolean;
    missingSetup: string[];
    isBusiness: boolean;
    agents: Array<{
      id: string;
      slug: string;
      name: string;
      role: string;
      kind: string;
      status: string;
      locationLevel: number;
      sprite: unknown;
      currentTask: { id: string; title: string; kind: string; status: string; startedAt: string | null; dueAt: string | null; blockedReason: string | null } | null;
      stats: { tasksDone: number; tasksFailed: number; successRate: number; avgReviewScore: number | null };
    }>;
  }>;
  pendingApprovals: number;
  recentEvents: Array<{ id: number; type: string; message: string; agentId: string | null; floorId: string | null; createdAt: string }>;
  lastTicks: Array<{ id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null; error: string | null }>;
  setup: Array<{ key: string; label: string; status: string; hint: string | null; requiredFor: string[] }>;
}

export async function getTowerState(db: Db, now = new Date()): Promise<TowerState> {
  const settingsMap = await getSettings(db);
  const simulationMode = asBool(settingsMap.simulation_mode, true);
  const [floorRows, agentRows, setupRows, real, simulated, events, tickRows, pending] = await Promise.all([
    db.select().from(floors).orderBy(desc(floors.level)),
    db.select().from(agents),
    db.select().from(setupItems).orderBy(setupItems.sort),
    getSpendSummary(db, false, now),
    getSpendSummary(db, true, now),
    db.select().from(taskEvents).orderBy(desc(taskEvents.id)).limit(40),
    db.select().from(ticks).orderBy(desc(ticks.startedAt)).limit(5),
    db.select({ id: approvals.id }).from(approvals).where(eq(approvals.status, "pending")),
  ]);

  const taskIds = agentRows.map((a) => a.currentTaskId).filter((x): x is string => !!x);
  const taskRows = taskIds.length ? await db.select().from(tasks).where(and(inArray(tasks.id, taskIds))) : [];
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const presentSetup = new Set(setupRows.filter((s) => s.status === "present").map((s) => s.key));
  const p = dubaiParts(now);

  return {
    now: now.toISOString(),
    dubai: { dayKey: p.dayKey, hour: p.hour, minute: p.minute, night: isNightInDubai(now) },
    simulationMode,
    budget: {
      level: asNumber(settingsMap.budget_level, 1),
      dailyCapUsd: asNumber(settingsMap.daily_cap_usd, 1.7),
      hardCeilingUsd: asNumber(settingsMap.hard_ceiling_usd, 5),
    },
    money: {
      real: { netUsd: real.netUsd, spendTodayUsd: real.todayUsd, verifiedRevenueUsd: real.verifiedRevenueUsd, totalSpendUsd: real.totalSpendUsd },
      simulated: { netUsd: simulated.netUsd, spendTodayUsd: simulated.todayUsd, verifiedRevenueUsd: simulated.verifiedRevenueUsd, totalSpendUsd: simulated.totalSpendUsd },
    },
    floors: floorRows.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      level: f.level,
      accent: f.accent,
      status: f.status,
      goalMetric: f.goalMetric,
      weeklyTarget: Number(f.weeklyTarget),
      targetUnit: f.targetUnit,
      unlockRule: f.unlockRule,
      strategyNote: f.strategyNote,
      pausedReason: f.pausedReason,
      throttled: !!f.throttledUntil && f.throttledUntil.getTime() > now.getTime(),
      behindTarget: f.status === "paused" || (!!f.throttledUntil && f.throttledUntil.getTime() > now.getTime()) || (!!f.strategyUpdatedAt && now.getTime() - f.strategyUpdatedAt.getTime() < 7 * 24 * 60 * 60 * 1000),
      missingSetup: (FLOOR_REQUIREMENTS[f.slug] ?? []).filter((k) => !presentSetup.has(k)),
      isBusiness: f.isBusiness,
      // A locked floor stands empty: its dust sheets show, its old crew does not (Deals closed 2026-09-30).
      agents: agentRows
        .filter((a) => a.floorId === f.id && f.status !== "locked")
        .map((a) => {
          const t = a.currentTaskId ? taskById.get(a.currentTaskId) : undefined;
          const total = a.tasksDone + a.tasksFailed;
          return {
            id: a.id,
            slug: a.slug,
            name: a.name,
            role: a.role,
            kind: a.kind,
            status: a.status,
            locationLevel: a.locationLevel,
            sprite: a.sprite,
            currentTask: t
              ? { id: t.id, title: t.title, kind: t.kind, status: t.status, startedAt: t.startedAt?.toISOString() ?? null, dueAt: t.dueAt?.toISOString() ?? null, blockedReason: t.blockedReason }
              : null,
            stats: {
              tasksDone: a.tasksDone,
              tasksFailed: a.tasksFailed,
              successRate: total ? Math.round((a.tasksDone / total) * 100) : 0,
              avgReviewScore: a.reviewCount ? Math.round((Number(a.reviewScoreSum) / a.reviewCount) * 10) / 10 : null,
            },
          };
        }),
    })),
    pendingApprovals: pending.length,
    recentEvents: events.map((e) => ({ id: e.id, type: e.type, message: e.message, agentId: e.agentId, floorId: e.floorId, createdAt: e.createdAt.toISOString() })),
    lastTicks: tickRows.map((t) => ({ id: t.id, trigger: t.trigger, status: t.status, startedAt: t.startedAt.toISOString(), finishedAt: t.finishedAt?.toISOString() ?? null, error: t.error })),
    setup: setupRows.map((s) => ({ key: s.key, label: s.label, status: s.status, hint: s.hint, requiredFor: s.requiredFor })),
  };
}
