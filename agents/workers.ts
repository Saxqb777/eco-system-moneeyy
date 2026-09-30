// Worker batch pipeline: queued real tasks become one batch per tick, results come back on later ticks.
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, agents, budgetLedger, floors, taskEvents, tasks } from "@/db/schema";
import { getSpendSummary } from "@/lib/budget";
import { asNumber, getSettings } from "@/lib/settings";
import { getClient, type ModelCall } from "./client";
import { submitBatch, type BatchItem, type CollectedResult } from "./batches";
import { playbookFor } from "./playbooks";

const EST_TASK_USD = 0.03;
const MAX_PER_BATCH = 20;

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

export async function submitQueuedTasks(db: Db, now = new Date()): Promise<{ status: string; reason?: string; submitted: number; skipped: number; held: string[] }> {
  const out = { status: "ok", submitted: 0, skipped: 0, held: [] as string[] };
  const client = await getClient(db);
  if (!client) return { ...out, status: "skipped", reason: "No Anthropic API key on the clipboard" };
  const settingsMap = await getSettings(db);
  const cap = asNumber(settingsMap.daily_cap_usd, 1.7);
  const spend = await getSpendSummary(db, false, now);
  if (spend.todayUsd >= cap) return { ...out, status: "held", reason: "daily cap reached" };

  const floorRows = await db.select().from(floors).where(eq(floors.status, "live"));
  const floorById = new Map(floorRows.map((f) => [f.id, f]));
  const agentRows = await db.select().from(agents);
  const agentById = new Map(agentRows.map((a) => [a.id, a]));
  const queued = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "queued"), eq(tasks.simulated, false)))
    .orderBy(asc(tasks.priority), asc(tasks.createdAt))
    .limit(60);

  const items: BatchItem[] = [];
  let budgetLeft = cap - spend.todayUsd;
  const floorSpend = { ...spend.todayByFloor };
  for (const t of queued) {
    if (items.length >= MAX_PER_BATCH) break;
    const floor = t.floorId ? floorById.get(t.floorId) : undefined;
    const agent = t.agentId ? agentById.get(t.agentId) : undefined;
    if (!floor || !agent) {
      out.skipped += 1;
      continue;
    }
    if (floor.throttledUntil && floor.throttledUntil.getTime() > now.getTime()) {
      if (!out.held.includes(floor.slug)) out.held.push(floor.slug);
      continue;
    }
    if ((floorSpend[floor.id] ?? 0) + EST_TASK_USD > cap * 0.4) {
      if (!out.held.includes(floor.slug)) out.held.push(floor.slug);
      continue;
    }
    if (budgetLeft < EST_TASK_USD) break;
    if (agent.currentTaskId && agent.currentTaskId !== t.id) continue; // one task at a time per worker
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
    };
    items.push({ customId: `task_${t.id}`, call });
    budgetLeft -= EST_TASK_USD;
    floorSpend[floor.id] = (floorSpend[floor.id] ?? 0) + EST_TASK_USD;
  }
  if (!items.length) return { ...out, status: out.held.length ? "held" : "idle", reason: out.held.length ? `floors near their share of the cap: ${out.held.join(", ")}` : "nothing queued" };

  const submitted = await submitBatch(db, items, now);
  for (const item of items) {
    const taskId = item.customId.slice("task_".length);
    const t = queued.find((x) => x.id === taskId)!;
    await db.update(tasks).set({ status: "running", startedAt: now, batchId: submitted?.batchId ?? null, batchCustomId: item.customId, attempts: t.attempts + 1, updatedAt: now }).where(eq(tasks.id, taskId));
    await db.update(agents).set({ status: "working", currentTaskId: taskId, updatedAt: now }).where(eq(agents.id, t.agentId!));
    await logEvent(db, { taskId, agentId: t.agentId, floorId: t.floorId, type: "started", message: `${agentById.get(t.agentId!)?.name ?? "Worker"} started: ${t.title}`, at: now });
  }
  out.submitted = items.length;
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
