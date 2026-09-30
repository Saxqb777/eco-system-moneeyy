// Worker batch pipeline: queued real tasks become one batch per tick, results come back on later ticks.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, agents, budgetLedger, floors, taskEvents, tasks } from "@/db/schema";
import { floorShare, getSpendSummary } from "@/lib/budget";
import { asNumber, getSettings } from "@/lib/settings";
import { callModel, getClient, type ModelCall } from "./client";
import { submitBatch, type BatchItem, type CollectedResult } from "./batches";
import { playbookFor } from "./playbooks";
import { estimateTaskUsd, inFlightUsd } from "./spend-guard";

const MAX_PER_BATCH = 20;
// Express mode: while settings.express_until is in the future, a tick runs up to this many tasks directly
// (full price, results in minutes) instead of a batch (half price, results in about an hour). Used for a
// verification run; everything else stays on batches.
export const EXPRESS_PER_TICK = 5;
const EXPRESS_STUCK_MS = 12 * 60 * 1000;
// The direct lane: short writing tasks (a deal post, a channel post, a first email, a reply) run straight away
// on every tick, full price but done in seconds, so nothing the owner or a lead waits on sits an hour in a
// batch. Research with web tools (Scouts, Analyst, share spots) stays on batches at half price.
export const DIRECT_KINDS = new Set(["write_post", "write_engagement", "draft_outreach", "follow_up", "marketing_pack", "success_email", "social_post", "social_replies"]);
export const DIRECT_PER_TICK = 4;
// Task ids a direct or express run marks in tasks.batch_id: no batch row stands behind them.
const DIRECT_MARKS = ["express", "direct"];

export function expressActive(settingsMap: Record<string, unknown>, now: Date): boolean {
  const v = settingsMap.express_until;
  return typeof v === "string" && Date.parse(v) > now.getTime();
}

// A tick that died mid direct or express run leaves tasks running with no batch to collect: put them back in the queue.
export async function requeueStuckExpress(db: Db, now: Date): Promise<number> {
  const stuck = await db.select().from(tasks).where(and(eq(tasks.status, "running"), inArray(tasks.batchId, DIRECT_MARKS), eq(tasks.simulated, false)));
  let n = 0;
  for (const t of stuck) {
    if (!t.startedAt || now.getTime() - t.startedAt.getTime() < EXPRESS_STUCK_MS) continue;
    await db.update(tasks).set({ status: t.attempts < 2 ? "queued" : "failed", blockedReason: t.attempts < 2 ? null : "Express run timed out twice", batchId: null, updatedAt: now }).where(eq(tasks.id, t.id));
    if (t.agentId) await db.update(agents).set({ status: "idle", currentTaskId: null, updatedAt: now }).where(and(eq(agents.id, t.agentId), eq(agents.currentTaskId, t.id)));
    n += 1;
  }
  return n;
}

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

export interface SubmitSummary {
  status: string;
  reason?: string;
  submitted: number;
  direct: number;
  skipped: number;
  held: string[]; // floors at their share of the cap
  paused: string[]; // floors with queued work that are paused
}

export async function submitQueuedTasks(db: Db, now = new Date()): Promise<SubmitSummary> {
  const out: SubmitSummary = { status: "ok", submitted: 0, direct: 0, skipped: 0, held: [], paused: [] };
  const client = await getClient(db);
  if (!client) return { ...out, status: "skipped", reason: "No Anthropic API key on the clipboard" };
  const settingsMap = await getSettings(db);
  const cap = asNumber(settingsMap.daily_cap_usd, 1.7);
  const spend = await getSpendSummary(db, false, now);
  if (spend.todayUsd >= cap) return { ...out, status: "held", reason: "daily cap reached" };

  const floorRows = await db.select().from(floors);
  const floorById = new Map(floorRows.filter((f) => f.status === "live").map((f) => [f.id, f]));
  const pausedById = new Map(floorRows.filter((f) => f.status === "paused").map((f) => [f.id, f]));
  const agentRows = await db.select().from(agents);
  const agentById = new Map(agentRows.map((a) => [a.id, a]));
  const queued = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "queued"), eq(tasks.simulated, false)))
    .orderBy(asc(tasks.priority), asc(tasks.createdAt))
    .limit(60);

  const express = expressActive(settingsMap, now);
  await requeueStuckExpress(db, now);
  // Work already in flight holds its estimate, so ticks one after another cannot fill the day past the cap.
  const reserved = await inFlightUsd(db, now);
  // Express sends everything down the direct lane, up to its own limit.
  const directLimit = express ? EXPRESS_PER_TICK : DIRECT_PER_TICK;
  const items: BatchItem[] = [];
  const direct = new Set<string>();
  let batched = 0;
  let busy = 0;
  let budgetLeft = cap - spend.todayUsd - reserved.totalUsd;
  const floorSpend: Record<string, number> = { ...spend.todayByFloor };
  for (const [floorId, usd] of Object.entries(reserved.byFloor)) floorSpend[floorId] = (floorSpend[floorId] ?? 0) + usd;
  let capReached = false;
  for (const t of queued) {
    if (direct.size >= directLimit && (express || batched >= MAX_PER_BATCH)) break;
    const goesDirect = express || DIRECT_KINDS.has(t.kind);
    if (goesDirect ? direct.size >= directLimit : batched >= MAX_PER_BATCH) continue;
    const floor = t.floorId ? floorById.get(t.floorId) : undefined;
    const agent = t.agentId ? agentById.get(t.agentId) : undefined;
    if (!floor || !agent) {
      const pausedFloor = t.floorId ? pausedById.get(t.floorId) : undefined;
      if (pausedFloor && !out.paused.includes(pausedFloor.slug)) out.paused.push(pausedFloor.slug);
      out.skipped += 1;
      continue;
    }
    if (floor.throttledUntil && floor.throttledUntil.getTime() > now.getTime()) {
      if (!out.held.includes(floor.slug)) out.held.push(floor.slug);
      continue;
    }
    const estimate = estimateTaskUsd(t.kind);
    if ((floorSpend[floor.id] ?? 0) + estimate > cap * floorShare(settingsMap, floor.slug)) {
      if (!out.held.includes(floor.slug)) out.held.push(floor.slug);
      continue;
    }
    if (budgetLeft < estimate) {
      // a cheaper writing task further down may still fit
      capReached = true;
      continue;
    }
    // One batch task at a time per worker. Direct tasks finish inside the tick, so a worker may run several.
    if (!goesDirect && agent.currentTaskId && agent.currentTaskId !== t.id) {
      busy += 1;
      continue;
    }
    const playbook = playbookFor(t.kind);
    if (!playbook) {
      await db.update(tasks).set({ status: "failed", blockedReason: `No playbook for ${t.kind}`, finishedAt: now, updatedAt: now }).where(eq(tasks.id, t.id));
      out.skipped += 1;
      continue;
    }
    const ctx = { db, now, floorId: floor.id, agentId: agent.id, agentName: agent.name };
    const prepared = await playbook.prepare(t, ctx);
    if ("skip" in prepared) {
      await db.update(tasks).set({ status: "done", output: { note: prepared.skip }, reviewScore: null, finishedAt: now, updatedAt: now }).where(eq(tasks.id, t.id));
      await logEvent(db, { taskId: t.id, agentId: agent.id, floorId: floor.id, type: "done", message: `${t.title}: ${prepared.skip}`, at: now });
      out.skipped += 1;
      continue;
    }
    const call: ModelCall = {
      agentKey: agent.modelKey === "builder" ? "builder" : "worker",
      agentId: agent.id,
      taskId: t.id,
      floorId: floor.id,
      system: playbook.system,
      messages: [{ role: "user", content: prepared.user }],
      schema: playbook.schema,
      maxTokens: playbook.maxTokens,
      webSearchMaxUses: prepared.webSearchMaxUses ?? playbook.webSearchMaxUses,
      webFetchMaxUses: prepared.webFetchMaxUses ?? playbook.webFetchMaxUses,
      effort: playbook.effort,
    };
    items.push({ customId: `task_${t.id}`, call });
    if (goesDirect) direct.add(`task_${t.id}`);
    else batched += 1;
    budgetLeft -= estimate;
    floorSpend[floor.id] = (floorSpend[floor.id] ?? 0) + estimate;
  }
  if (!items.length) {
    if (capReached) return { ...out, status: "held", reason: "daily cap reached" };
    if (out.paused.length && !out.held.length && !busy) return { ...out, status: "held", reason: `floors paused: ${out.paused.join(", ")}` };
    return { ...out, status: out.held.length ? "held" : "idle", reason: out.held.length ? `floors near their share of the cap: ${out.held.join(", ")}` : busy ? `${busy} task${busy === 1 ? "" : "s"} waiting for a busy worker` : "nothing queued" };
  }

  let batchItems = items.filter((i) => !direct.has(i.customId));
  const directItems = items.filter((i) => direct.has(i.customId));
  let submitted: Awaited<ReturnType<typeof submitBatch>> | null = null;
  if (batchItems.length) {
    // A batch that cannot be submitted leaves its tasks queued for the next tick; the direct lane still runs.
    try {
      submitted = await submitBatch(db, batchItems, now);
    } catch (err) {
      out.reason = `batch submit failed: ${err instanceof Error ? err.message : String(err)}`;
      batchItems = [];
    }
  }
  const started = [...batchItems, ...directItems];
  if (!started.length) return { ...out, status: "failed" };
  const mark = express ? "express" : "direct";
  for (const item of started) {
    const taskId = item.customId.slice("task_".length);
    const t = queued.find((x) => x.id === taskId)!;
    const isDirect = direct.has(item.customId);
    await db.update(tasks).set({ status: "running", startedAt: now, batchId: isDirect ? mark : (submitted?.batchId ?? null), batchCustomId: item.customId, attempts: t.attempts + 1, updatedAt: now }).where(eq(tasks.id, taskId));
    await db.update(agents).set({ status: "working", currentTaskId: taskId, updatedAt: now }).where(eq(agents.id, t.agentId!));
    await logEvent(db, { taskId, agentId: t.agentId, floorId: t.floorId, type: "started", message: `${agentById.get(t.agentId!)?.name ?? "Worker"} started: ${t.title}${express ? " (express)" : ""}`, at: now });
  }
  out.submitted = started.length;
  out.direct = directItems.length;
  if (directItems.length) {
    // The model calls run side by side. The results are absorbed one after another, exactly as batch results
    // are, so rules that count (the daily auto send cap) never see two drafts at once.
    const results = await Promise.all(
      directItems.map(async (item): Promise<CollectedResult> => {
        try {
          const res = await callModel(db, { ...item.call, customId: item.customId }, now);
          return { customId: item.customId, ok: res.stopReason !== "max_tokens" || res.json !== null, text: res.text, json: res.json, costUsd: res.costUsd, runId: res.runId, error: res.stopReason === "max_tokens" && res.json === null ? "the answer was cut off (max tokens)" : null };
        } catch (err) {
          return { customId: item.customId, ok: false, text: "", json: null, costUsd: 0, runId: null, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    for (const r of results) await handleTaskBatchResult(db, r, now);
    if (express) out.status = "express";
  }
  return out;
}

// A worker's batch result: absorb the output into rows, hand the task to Warden for review.
export async function handleTaskBatchResult(db: Db, r: CollectedResult, now = new Date()): Promise<void> {
  const taskId = r.customId.slice("task_".length);
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || t.status !== "running") return;
  const agent = t.agentId ? (await db.select().from(agents).where(eq(agents.id, t.agentId)).limit(1))[0] : undefined;
  if (r.runId) {
    await db.update(agentRuns).set({ agentId: t.agentId, floorId: t.floorId, taskId: t.id }).where(eq(agentRuns.id, r.runId));
    await db.update(budgetLedger).set({ agentId: t.agentId, floorId: t.floorId, taskId: t.id }).where(eq(budgetLedger.agentRunId, r.runId));
  }
  const release = async () => {
    if (agent && agent.currentTaskId === t.id) await db.update(agents).set({ status: "idle", currentTaskId: null, updatedAt: now }).where(eq(agents.id, agent.id));
  };
  if (!r.ok) {
    const retry = t.attempts < 2;
    await db.update(tasks).set({ status: retry ? "queued" : "failed", blockedReason: retry ? null : `Model call failed: ${r.error ?? "unknown"}`, updatedAt: now, ...(retry ? {} : { finishedAt: now }) }).where(eq(tasks.id, t.id));
    await logEvent(db, { taskId: t.id, agentId: t.agentId, floorId: t.floorId, type: retry ? "log" : "failed", message: retry ? `${t.title}: the model call failed, trying again` : `${t.title} failed: ${r.error ?? "unknown"}`, at: now });
    await release();
    return;
  }
  const playbook = playbookFor(t.kind);
  const output = (r.json && typeof r.json === "object" ? (r.json as Record<string, unknown>) : { text: r.text }) as Record<string, unknown>;
  let summary = "Task finished";
  let extra: Record<string, unknown> = {};
  if (playbook) {
    try {
      const absorbed = await playbook.absorb(t, output, { db, now, floorId: t.floorId, agentId: t.agentId, agentName: agent?.name ?? "Worker" });
      summary = absorbed.summary;
      extra = absorbed.extra ?? {};
    } catch (err) {
      summary = `Output could not be absorbed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  await db.update(tasks).set({ status: "review", output: { ...extra, summary, raw: output }, finishedAt: now, updatedAt: now }).where(eq(tasks.id, t.id));
  await logEvent(db, { taskId: t.id, agentId: t.agentId, floorId: t.floorId, type: "output", message: summary, data: extra, at: now });
  await release();
}

export async function tasksInBatch(db: Db, batchId: string) {
  return db.select().from(tasks).where(and(eq(tasks.batchId, batchId), inArray(tasks.status, ["running"])));
}
