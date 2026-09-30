// Panel data: one worker, one floor, or the Warden's desk. Real rows or simulated rows, never mixed.
import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { FLOOR_REQUIREMENTS } from "@/config/tower";
import type { Db } from "@/db/client";
import { agentRuns, agents, approvals, budgetLedger, floors, leads, posts, revenue, setupItems, taskEvents, tasks, wardenRuns } from "@/db/schema";
import { buildBrief, type Brief } from "@/lib/brief";
import { asBool, asNumber, getSettings } from "@/lib/settings";
import { describeTaskOutput, validateAgentName } from "@/lib/tasks";
import { visibleSetupRows } from "@/lib/clipboard";
import { dubaiDayStartUtc, dubaiWeekStartUtc } from "@/lib/time";

export interface AgentDetail {
  id: string;
  slug: string;
  name: string;
  role: string;
  kind: string;
  status: string;
  modelKey: string;
  sprite: unknown;
  floor: { slug: string; name: string; level: number; accent: string } | null;
  currentTask: { id: string; title: string; kind: string; status: string; startedAt: string | null; dueAt: string | null; blockedReason: string | null; feedback: string | null } | null;
  log: Array<{ id: number; type: string; message: string; taskId: string | null; createdAt: string }>;
  history: Array<{ id: string; title: string; kind: string; status: string; startedAt: string | null; finishedAt: string | null; reviewScore: number | null; reviewReason: string | null; summary: string }>;
  today: { runs: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; webSearches: number; costUsd: number };
  stats: { tasksDone: number; tasksFailed: number; successRate: number; avgReviewScore: number | null };
  simulated: boolean;
}

export interface FloorDetail {
  id: string;
  slug: string;
  name: string;
  level: number;
  accent: string;
  status: string;
  goalMetric: string;
  weeklyTarget: number;
  targetUnit: string;
  weeklyActual: number;
  measure: string;
  unlockRule: string | null;
  strategyNote: string | null;
  strategyUpdatedAt: string | null;
  pausedReason: string | null;
  throttledUntil: string | null;
  niche: string | null;
  monthlyGuideUsd: number;
  autoApprove: boolean;
  isBusiness: boolean;
  missingSetup: Array<{ key: string; label: string }>;
  agents: Array<{ id: string; slug: string; name: string; role: string; status: string }>;
  activeTasks: Array<{ id: string; title: string; agentName: string; status: string; startedAt: string | null; dueAt: string | null; blockedReason: string | null }>;
  blockers: Array<{ taskId: string; title: string; agentName: string; reason: string; since: string | null }>;
  queued: number;
  doneThisWeek: number;
  money: { revenueWeekUsd: number; revenueTotalUsd: number; spendWeekUsd: number; spendTodayUsd: number };
  simulated: boolean;
}

export interface WardenSummary {
  brief: Brief;
  budget: { level: number; dailyCapUsd: number; hardCeilingUsd: number; spendTodayUsd: number; todayByFloor: Array<{ slug: string; name: string; usd: number }>; allocationGuide: Record<string, number> };
  runs: Array<{ id: string; mode: string; trigger: string; status: string; summary: string | null; costUsd: number; startedAt: string }>;
  pendingApprovals: number;
  missingSetup: Array<{ key: string; label: string; requiredFor: string[] }>;
  simulated: boolean;
}

const COST_KINDS = ["api_cost", "web_search"];

async function simulationOn(db: Db): Promise<boolean> {
  const s = await getSettings(db);
  return asBool(s.simulation_mode, true);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function getAgentDetail(db: Db, agentId: string, now = new Date()): Promise<AgentDetail | null> {
  const [a] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!a) return null;
  const simulated = await simulationOn(db);
  const [floor] = a.floorId ? await db.select().from(floors).where(eq(floors.id, a.floorId)).limit(1) : [];
  const current = a.currentTaskId ? (await db.select().from(tasks).where(eq(tasks.id, a.currentTaskId)).limit(1))[0] : undefined;

  const historyRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.agentId, a.id), eq(tasks.simulated, simulated)))
    .orderBy(desc(tasks.createdAt))
    .limit(20);
  const taskIds = historyRows.map((t) => t.id);
  if (current && !taskIds.includes(current.id)) taskIds.push(current.id);

  const eventRows = await db
    .select()
    .from(taskEvents)
    .where(taskIds.length ? or(eq(taskEvents.agentId, a.id), inArray(taskEvents.taskId, taskIds)) : eq(taskEvents.agentId, a.id))
    .orderBy(desc(taskEvents.id))
    .limit(40);

  const dayStart = dubaiDayStartUtc(now);
  const [today] = await db
    .select({
      runs: sql<string>`count(*)`,
      inputTokens: sql<string>`coalesce(sum(${agentRuns.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${agentRuns.outputTokens}), 0)`,
      cacheReadTokens: sql<string>`coalesce(sum(${agentRuns.cacheReadTokens}), 0)`,
      webSearches: sql<string>`coalesce(sum(${agentRuns.webSearchCount}), 0)`,
      costUsd: sql<string>`coalesce(sum(${agentRuns.costUsd}), 0)`,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.agentId, a.id), eq(agentRuns.simulated, simulated), gte(agentRuns.startedAt, dayStart)));

  const total = a.tasksDone + a.tasksFailed;
  return {
    id: a.id,
    slug: a.slug,
    name: a.name,
    role: a.role,
    kind: a.kind,
    status: a.status,
    modelKey: a.modelKey,
    sprite: a.sprite,
    floor: floor ? { slug: floor.slug, name: floor.name, level: floor.level, accent: floor.accent } : null,
    currentTask: current
      ? { id: current.id, title: current.title, kind: current.kind, status: current.status, startedAt: iso(current.startedAt), dueAt: iso(current.dueAt), blockedReason: current.blockedReason, feedback: current.feedback }
      : null,
    log: eventRows.reverse().map((e) => ({ id: e.id, type: e.type, message: e.message, taskId: e.taskId, createdAt: e.createdAt.toISOString() })),
    history: historyRows.map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      status: t.status,
      startedAt: iso(t.startedAt),
      finishedAt: iso(t.finishedAt),
      reviewScore: t.reviewScore,
      reviewReason: t.reviewReason,
      summary: t.status === "done" || t.status === "rejected" ? describeTaskOutput(t.kind, (t.output ?? {}) as Record<string, unknown>, t.status === "rejected") : t.blockedReason ? `Blocked: ${t.blockedReason}` : t.status === "running" ? "In progress" : "Waiting in the queue",
    })),
    today: {
      runs: Number(today?.runs ?? 0),
      inputTokens: Number(today?.inputTokens ?? 0),
      outputTokens: Number(today?.outputTokens ?? 0),
      cacheReadTokens: Number(today?.cacheReadTokens ?? 0),
      webSearches: Number(today?.webSearches ?? 0),
      costUsd: Number(today?.costUsd ?? 0),
    },
    stats: {
      tasksDone: a.tasksDone,
      tasksFailed: a.tasksFailed,
      successRate: total ? Math.round((a.tasksDone / total) * 100) : 0,
      avgReviewScore: a.reviewCount ? Math.round((Number(a.reviewScoreSum) / a.reviewCount) * 10) / 10 : null,
    },
    simulated,
  };
}

export async function renameAgent(db: Db, agentId: string, raw: unknown, now = new Date()): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const check = validateAgentName(raw);
  if (!check.ok) return check;
  const [row] = await db.update(agents).set({ name: check.name, updatedAt: now }).where(eq(agents.id, agentId)).returning({ id: agents.id, floorId: agents.floorId });
  if (!row) return { ok: false, error: "Worker not found" };
  await db.insert(taskEvents).values({ agentId, floorId: row.floorId, type: "log", message: `Renamed to ${check.name} by the owner`, createdAt: now });
  return { ok: true, name: check.name };
}

// The weekly number behind each floor's goal metric. Proxies are labelled as such until the real source connects.
export async function weeklyActual(db: Db, floor: typeof floors.$inferSelect, simulated: boolean, weekStart: Date): Promise<{ value: number; measure: string }> {
  switch (floor.slug) {
    case "docledger": {
      const [r] = await db
        .select({ n: sql<string>`count(*)` })
        .from(leads)
        .where(and(eq(leads.floorId, floor.id), eq(leads.simulated, simulated), eq(leads.status, "demo_booked"), gte(leads.updatedAt, weekStart)));
      return { value: Number(r?.n ?? 0), measure: "Demos booked this week" };
    }
    case "deals": {
      const s = await getSettings(db);
      if (!simulated && typeof s.channel_subscribers === "number") return { value: s.channel_subscribers, measure: "Channel subscribers, refreshed daily from Telegram" };
      const [r] = await db
        .select({ n: sql<string>`count(*)` })
        .from(posts)
        .where(and(eq(posts.floorId, floor.id), eq(posts.simulated, simulated), eq(posts.status, "posted"), gte(posts.postedAt, weekStart)));
      return { value: Number(r?.n ?? 0), measure: "Posts published this week (subscriber count arrives with the channel)" };
    }
    case "growth": {
      // The Growth floor's goal is the company's: companies that became paying customers this week.
      const [r] = await db
        .select({ n: sql<string>`count(*)` })
        .from(leads)
        .where(and(eq(leads.simulated, simulated), eq(leads.status, "client"), gte(leads.updatedAt, weekStart)));
      return { value: Number(r?.n ?? 0), measure: "Paying customers this week" };
    }
    case "penthouse":
    case "lobby": {
      const [rev] = await db
        .select({ t: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
        .from(revenue)
        .where(and(eq(revenue.simulated, simulated), eq(revenue.verified, true), gte(revenue.occurredAt, weekStart)));
      const [spend] = await db
        .select({ t: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
        .from(budgetLedger)
        .where(and(eq(budgetLedger.simulated, simulated), inArray(budgetLedger.kind, COST_KINDS), gte(budgetLedger.occurredAt, weekStart)));
      return { value: Math.round((Number(rev?.t ?? 0) - Number(spend?.t ?? 0)) * 100) / 100, measure: floor.slug === "lobby" ? "Net this week, USD" : "Tower net this week, USD" };
    }
    default:
      return { value: 0, measure: floor.goalMetric };
  }
}

export async function getFloorDetail(db: Db, slug: string, now = new Date()): Promise<FloorDetail | null> {
  const [f] = await db.select().from(floors).where(eq(floors.slug, slug)).limit(1);
  if (!f || f.status === "archived") return null;
  const simulated = await simulationOn(db);
  const weekStart = dubaiWeekStartUtc(now);
  const dayStart = dubaiDayStartUtc(now);

  const agentRows = await db.select().from(agents).where(eq(agents.floorId, f.id)).orderBy(agents.slug);
  const nameById = new Map(agentRows.map((a) => [a.id, a.name]));
  const active = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.floorId, f.id), eq(tasks.simulated, simulated), inArray(tasks.status, ["running", "blocked"])))
    .orderBy(desc(tasks.startedAt))
    .limit(20);
  const [queued] = await db
    .select({ n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.floorId, f.id), eq(tasks.simulated, simulated), eq(tasks.status, "queued")));
  const [doneWeek] = await db
    .select({ n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.floorId, f.id), eq(tasks.simulated, simulated), eq(tasks.status, "done"), gte(tasks.finishedAt, weekStart)));
  const [revWeek] = await db
    .select({ t: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
    .from(revenue)
    .where(and(eq(revenue.floorId, f.id), eq(revenue.simulated, simulated), eq(revenue.verified, true), gte(revenue.occurredAt, weekStart)));
  const [revTotal] = await db
    .select({ t: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` })
    .from(revenue)
    .where(and(eq(revenue.floorId, f.id), eq(revenue.simulated, simulated), eq(revenue.verified, true)));
  const [spendWeek] = await db
    .select({ t: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.floorId, f.id), eq(budgetLedger.simulated, simulated), inArray(budgetLedger.kind, COST_KINDS), gte(budgetLedger.occurredAt, weekStart)));
  const [spendToday] = await db
    .select({ t: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.floorId, f.id), eq(budgetLedger.simulated, simulated), inArray(budgetLedger.kind, COST_KINDS), gte(budgetLedger.occurredAt, dayStart)));
  const weekly = await weeklyActual(db, f, simulated, weekStart);

  const required = FLOOR_REQUIREMENTS[f.slug] ?? [];
  const setupRows = required.length ? await db.select().from(setupItems).where(inArray(setupItems.key, required)) : [];
  const missingSetup = setupRows.filter((s) => s.status !== "present").map((s) => ({ key: s.key, label: s.label }));

  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    level: f.level,
    accent: f.accent,
    status: f.status,
    goalMetric: f.goalMetric,
    weeklyTarget: Number(f.weeklyTarget),
    targetUnit: f.targetUnit,
    weeklyActual: weekly.value,
    measure: weekly.measure,
    unlockRule: f.unlockRule,
    strategyNote: f.strategyNote,
    strategyUpdatedAt: iso(f.strategyUpdatedAt),
    pausedReason: f.pausedReason,
    throttledUntil: f.throttledUntil && f.throttledUntil.getTime() > now.getTime() ? f.throttledUntil.toISOString() : null,
    niche: f.niche,
    monthlyGuideUsd: Number(f.monthlyGuideUsd),
    autoApprove: f.autoApprove,
    isBusiness: f.isBusiness,
    missingSetup,
    agents: agentRows.map((a) => ({ id: a.id, slug: a.slug, name: a.name, role: a.role, status: a.status })),
    activeTasks: active.map((t) => ({ id: t.id, title: t.title, agentName: (t.agentId && nameById.get(t.agentId)) || "Unassigned", status: t.status, startedAt: iso(t.startedAt), dueAt: iso(t.dueAt), blockedReason: t.blockedReason })),
    blockers: active.filter((t) => t.status === "blocked").map((t) => ({ taskId: t.id, title: t.title, agentName: (t.agentId && nameById.get(t.agentId)) || "Unassigned", reason: t.blockedReason ?? "No reason recorded", since: iso(t.updatedAt) })),
    queued: Number(queued?.n ?? 0),
    doneThisWeek: Number(doneWeek?.n ?? 0),
    money: { revenueWeekUsd: Number(revWeek?.t ?? 0), revenueTotalUsd: Number(revTotal?.t ?? 0), spendWeekUsd: Number(spendWeek?.t ?? 0), spendTodayUsd: Number(spendToday?.t ?? 0) },
    simulated,
  };
}

// Owner pause and resume. Workers on the floor stop at their desks; the simulation and the pipeline skip paused floors.
export async function setFloorPaused(db: Db, slug: string, paused: boolean, now = new Date()): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const [f] = await db.select().from(floors).where(eq(floors.slug, slug)).limit(1);
  if (!f) return { ok: false, error: "Floor not found" };
  if (f.status === "locked") return { ok: false, error: "That floor is still locked" };
  if (paused && f.status === "paused") return { ok: true, status: "paused" };
  if (!paused && f.status === "live") return { ok: true, status: "live" };
  if (paused) {
    await db.update(floors).set({ status: "paused", pausedReason: "Paused by the owner", updatedAt: now }).where(eq(floors.id, f.id));
    await db.update(agents).set({ status: "paused", updatedAt: now }).where(and(eq(agents.floorId, f.id), inArray(agents.status, ["working", "idle", "riding"])));
  } else {
    await db.update(floors).set({ status: "live", pausedReason: null, updatedAt: now }).where(eq(floors.id, f.id));
    const parked = await db.select({ id: agents.id, currentTaskId: agents.currentTaskId }).from(agents).where(and(eq(agents.floorId, f.id), eq(agents.status, "paused")));
    for (const a of parked) {
      await db.update(agents).set({ status: a.currentTaskId ? "working" : "idle", updatedAt: now }).where(eq(agents.id, a.id));
    }
  }
  await db.insert(taskEvents).values({ floorId: f.id, type: "log", message: paused ? `${f.name} paused by the owner` : `${f.name} resumed by the owner`, createdAt: now });
  return { ok: true, status: paused ? "paused" : "live" };
}

export async function getWardenSummary(db: Db, now = new Date()): Promise<WardenSummary> {
  const settingsMap = await getSettings(db);
  const simulated = asBool(settingsMap.simulation_mode, true);
  const dayStart = dubaiDayStartUtc(now);
  const brief = await buildBrief(db, now);
  const floorRows = await db.select({ id: floors.id, slug: floors.slug, name: floors.name }).from(floors).where(ne(floors.status, "archived")).orderBy(desc(floors.level));
  const todayRows = await db
    .select({ floorId: budgetLedger.floorId, total: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.simulated, simulated), inArray(budgetLedger.kind, COST_KINDS), gte(budgetLedger.occurredAt, dayStart)))
    .groupBy(budgetLedger.floorId);
  const byFloor = new Map(todayRows.map((r) => [r.floorId ?? "", Number(r.total)]));
  const runs = await db.select().from(wardenRuns).where(eq(wardenRuns.simulated, simulated)).orderBy(desc(wardenRuns.startedAt)).limit(6);
  const [pending] = await db.select({ n: sql<string>`count(*)` }).from(approvals).where(and(eq(approvals.status, "pending"), eq(approvals.simulated, simulated)));
  const setupRows = await visibleSetupRows(db);
  const guide = (settingsMap.allocation_guide_usd ?? {}) as Record<string, number>;
  return {
    brief,
    budget: {
      level: asNumber(settingsMap.budget_level, 1),
      dailyCapUsd: asNumber(settingsMap.daily_cap_usd, 1.7),
      hardCeilingUsd: asNumber(settingsMap.hard_ceiling_usd, 5),
      spendTodayUsd: [...byFloor.values()].reduce((a, b) => a + b, 0),
      todayByFloor: floorRows.map((f) => ({ slug: f.slug, name: f.name, usd: byFloor.get(f.id) ?? 0 })).filter((f) => f.usd > 0),
      allocationGuide: guide,
    },
    runs: runs.map((r) => ({ id: r.id, mode: r.mode, trigger: r.trigger, status: r.status, summary: r.summary, costUsd: Number(r.costUsd), startedAt: r.startedAt.toISOString() })),
    pendingApprovals: Number(pending?.n ?? 0),
    missingSetup: setupRows.filter((s) => s.status !== "present").map((s) => ({ key: s.key, label: s.label, requiredFor: s.requiredFor })),
    simulated,
  };
}
