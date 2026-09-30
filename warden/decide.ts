// One Warden run: snapshot in, one decision object out, code applies it. Batch for the schedule, sync for instant runs.
import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, agents, budgetLedger, floors, messagesOut, wardenRuns } from "@/db/schema";
import { asBool, getSettings } from "@/lib/settings";
import { enqueueMessage } from "@/lib/telegram";
import { callModel, getClient, type ModelCall } from "@/agents/client";
import { submitBatch, type CollectedResult } from "@/agents/batches";
import { budgetLeftUsd, WARDEN_RUN_USD } from "@/agents/spend-guard";
import { applyWardenDecisions } from "./apply";
import { parseDecisions, WARDEN_SCHEMA, WARDEN_SYSTEM } from "./prompt";
import { buildSnapshot } from "./snapshot";

export type WardenTrigger = "schedule" | "manual" | "setup" | "idea" | "blocked";

export interface WardenRunResult {
  status: "applied" | "submitted" | "skipped" | "held" | "failed";
  runId?: string;
  reason?: string;
  summary?: string;
  costUsd?: number;
}

const INSTANT_LIMIT_MS = 60 * 60 * 1000;
const FAIL_ALERT_GAP_MS = 6 * 60 * 60 * 1000;

// A failed Warden run reaches the owner's phone, at most once every six hours, so a silent brain never goes unnoticed.
export async function alertWardenFailed(db: Db, reason: string, now = new Date()): Promise<boolean> {
  const [recent] = await db
    .select({ id: messagesOut.id })
    .from(messagesOut)
    .where(and(eq(messagesOut.kind, "warden_failed"), gte(messagesOut.createdAt, new Date(now.getTime() - FAIL_ALERT_GAP_MS))))
    .limit(1);
  if (recent) return false;
  await enqueueMessage(db, {
    kind: "warden_failed",
    body: `Warden's run failed: ${reason.slice(0, 300)}\nThe floors keep working on their own rules and Warden tries again on his next slot. Nothing is needed from you unless this message repeats.`,
    now,
  });
  return true;
}

async function wardenAgent(db: Db) {
  const [w] = await db.select().from(agents).where(eq(agents.kind, "warden")).limit(1);
  return w ?? null;
}

export async function runWarden(db: Db, opts: { mode: "sync" | "batch"; trigger: WardenTrigger; now?: Date }): Promise<WardenRunResult> {
  const now = opts.now ?? new Date();
  const settingsMap = await getSettings(db);
  if (asBool(settingsMap.simulation_mode, true)) return { status: "skipped", reason: "simulation mode: Warden runs are simulated" };
  const client = await getClient(db);
  if (!client) {
    await db.insert(wardenRuns).values({ mode: opts.mode, trigger: opts.trigger, status: "failed", summary: "No Anthropic API key on the clipboard", startedAt: now, finishedAt: now, simulated: false });
    return { status: "failed", reason: "No Anthropic API key on the clipboard" };
  }
  // Rule 2: Warden thinks only when his run fits under today's cap, work in flight counted.
  const budget = await budgetLeftUsd(db, now);
  if (budget.leftUsd < WARDEN_RUN_USD) return { status: "held", reason: `daily cap reached: ${budget.spentUsd.toFixed(2)} of ${budget.capUsd.toFixed(2)} USD spent` };
  if (opts.mode === "sync") {
    const since = new Date(now.getTime() - INSTANT_LIMIT_MS);
    const [recent] = await db
      .select({ id: wardenRuns.id })
      .from(wardenRuns)
      .where(and(eq(wardenRuns.trigger, opts.trigger), eq(wardenRuns.simulated, false), gte(wardenRuns.startedAt, since)))
      .limit(1);
    if (recent) return { status: "skipped", reason: `an instant run for ${opts.trigger} already happened this hour` };
  }
  const warden = await wardenAgent(db);
  const snapshot = await buildSnapshot(db, now);
  const [run] = await db.insert(wardenRuns).values({ mode: opts.mode, trigger: opts.trigger, status: "submitted", snapshot, startedAt: now, simulated: false }).returning({ id: wardenRuns.id });
  const runId = run?.id ?? "";
  const call: ModelCall = {
    agentKey: "warden",
    agentId: warden?.id ?? null,
    floorId: warden?.floorId ?? null,
    system: WARDEN_SYSTEM,
    messages: [{ role: "user", content: `Snapshot for this run:\n${JSON.stringify(snapshot)}\n\nDecide and return the JSON object.` }],
    schema: WARDEN_SCHEMA,
    maxTokens: 8000, // 3000 cut the answer off once Warden also steered growth and sales (2026-09-30)
    customId: `warden_${runId}`,
  };

  if (opts.mode === "batch") {
    try {
      const submitted = await submitBatch(db, [{ customId: `warden_${runId}`, call }], now);
      await db.update(wardenRuns).set({ batchId: submitted?.batchId ?? null }).where(eq(wardenRuns.id, runId));
      return { status: "submitted", runId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(wardenRuns).set({ status: "failed", summary: `Batch submit failed: ${message}`, finishedAt: now }).where(eq(wardenRuns.id, runId));
      await alertWardenFailed(db, `batch submit: ${message}`, now);
      return { status: "failed", runId, reason: message };
    }
  }

  try {
    const result = await callModel(db, call, now);
    const decisions = parseDecisions(result.json);
    if (!decisions) throw new Error("Warden returned no usable decision object");
    const applied = await applyWardenDecisions(db, runId, decisions, new Date());
    await db.update(wardenRuns).set({ status: "applied", decisions: { ...decisions, applied }, summary: decisions.summary, costUsd: result.costUsd.toFixed(6), agentRunId: result.runId, finishedAt: new Date() }).where(eq(wardenRuns.id, runId));
    return { status: "applied", runId, summary: decisions.summary, costUsd: result.costUsd };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(wardenRuns).set({ status: "failed", summary: `Run failed: ${message}`, finishedAt: new Date() }).where(eq(wardenRuns.id, runId));
    await alertWardenFailed(db, message, now);
    return { status: "failed", runId, reason: message };
  }
}

// Called by the tick's collect step when a scheduled batch run comes back.
export async function handleWardenBatchResult(db: Db, r: CollectedResult, now = new Date()): Promise<void> {
  const runId = r.customId.slice("warden_".length);
  const [run] = await db.select().from(wardenRuns).where(eq(wardenRuns.id, runId)).limit(1);
  if (!run || run.status !== "submitted") return;
  const warden = await wardenAgent(db);
  if (r.runId) {
    await db.update(agentRuns).set({ agentId: warden?.id ?? null, floorId: warden?.floorId ?? null }).where(eq(agentRuns.id, r.runId));
    await db.update(budgetLedger).set({ agentId: warden?.id ?? null, floorId: warden?.floorId ?? null }).where(eq(budgetLedger.agentRunId, r.runId));
  }
  if (!r.ok) {
    await db.update(wardenRuns).set({ status: "failed", summary: `Batch result failed: ${r.error ?? "unknown"}`, agentRunId: r.runId, finishedAt: now }).where(eq(wardenRuns.id, runId));
    await alertWardenFailed(db, r.error ?? "the batch result failed", now);
    return;
  }
  const decisions = parseDecisions(r.json);
  if (!decisions) {
    await db.update(wardenRuns).set({ status: "failed", summary: "Warden returned no usable decision object", agentRunId: r.runId, costUsd: r.costUsd.toFixed(6), finishedAt: now }).where(eq(wardenRuns.id, runId));
    await alertWardenFailed(db, "Warden returned no usable decision object", now);
    return;
  }
  const applied = await applyWardenDecisions(db, runId, decisions, now);
  await db.update(wardenRuns).set({ status: "applied", decisions: { ...decisions, applied }, summary: decisions.summary, costUsd: r.costUsd.toFixed(6), agentRunId: r.runId, finishedAt: now }).where(eq(wardenRuns.id, runId));
}

// Was a scheduled run already started in this interval slot?
export async function scheduledRunExists(db: Db, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: wardenRuns.id })
    .from(wardenRuns)
    .where(and(eq(wardenRuns.trigger, "schedule"), eq(wardenRuns.simulated, false), gte(wardenRuns.startedAt, since)))
    .orderBy(desc(wardenRuns.startedAt))
    .limit(1);
  return !!row;
}

export async function penthouseId(db: Db): Promise<string | null> {
  const [f] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "penthouse")).limit(1);
  return f?.id ?? null;
}
