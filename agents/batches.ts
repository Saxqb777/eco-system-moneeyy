// The Batch API pipeline: submit queued requests as one batch, collect ended batches on the next ticks.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { batches } from "@/db/schema";
import { buildParams, getClient, modelFor, parseJson, recordRun, textOf, usageOf, type ModelCall } from "./client";

export interface BatchItem {
  customId: string; // "warden_<runId>" or "task_<taskId>", letters, digits, underscore and hyphen only
  call: ModelCall;
}

export interface CollectedResult {
  customId: string;
  ok: boolean;
  text: string;
  json: unknown;
  costUsd: number;
  runId: string | null;
  error: string | null;
}

export async function submitBatch(db: Db, items: BatchItem[], now = new Date()): Promise<{ batchId: string; count: number } | null> {
  if (!items.length) return null;
  const client = await getClient(db);
  if (!client) throw new Error("No Anthropic API key on the clipboard");
  const requests = [];
  for (const item of items) {
    const model = await modelFor(db, item.call.agentKey);
    requests.push({ custom_id: item.customId, params: buildParams({ ...item.call, customId: item.customId }, model) });
  }
  const created = await client.messages.batches.create({ requests });
  await db.insert(batches).values({ id: created.id, status: "submitted", requestCount: items.length, submittedAt: now });
  return { batchId: created.id, count: items.length };
}

// Asks Anthropic about every open batch. Ended batches are read once, logged and handed to the caller.
export async function collectBatches(db: Db, now = new Date(), onResult?: (r: CollectedResult, batchId: string) => Promise<void>): Promise<{ checked: number; collected: number; results: number }> {
  const open = await db.select().from(batches).where(inArray(batches.status, ["submitted", "in_progress"]));
  if (!open.length) return { checked: 0, collected: 0, results: 0 };
  const client = await getClient(db);
  if (!client) return { checked: open.length, collected: 0, results: 0 };
  let collected = 0;
  let results = 0;
  for (const b of open) {
    let status;
    try {
      status = await client.messages.batches.retrieve(b.id);
    } catch (err) {
      await db.update(batches).set({ error: err instanceof Error ? err.message : String(err) }).where(eq(batches.id, b.id));
      continue;
    }
    if (status.processing_status !== "ended") {
      if (b.status !== "in_progress") await db.update(batches).set({ status: "in_progress" }).where(eq(batches.id, b.id));
      continue;
    }
    const endedAt = status.ended_at ? new Date(status.ended_at) : now;
    const stream = await client.messages.batches.results(b.id);
    for await (const item of stream) {
      results += 1;
      const custom = item.custom_id;
      let out: CollectedResult;
      if (item.result.type === "succeeded" && item.result.message) {
        const message = item.result.message;
        const usage = usageOf(message);
        const { runId, costUsd } = await recordRun(db, {
          call: { agentId: null, customId: custom },
          model: message.model,
          mode: "batch",
          usage,
          durationMs: null,
          stopReason: message.stop_reason ?? null,
          batchId: b.id,
          startedAt: b.submittedAt,
          finishedAt: endedAt,
        });
        const text = textOf(message);
        out = { customId: custom, ok: true, text, json: parseJson(text), costUsd, runId, error: null };
      } else {
        const error = item.result.type === "errored" ? JSON.stringify(item.result.error ?? "error") : item.result.type;
        await recordRun(db, { call: { agentId: null, customId: custom }, model: "unknown", mode: "batch", usage: { inputTokens: 0, outputTokens: 0 }, durationMs: null, stopReason: null, batchId: b.id, error, startedAt: b.submittedAt, finishedAt: endedAt });
        out = { customId: custom, ok: false, text: "", json: null, costUsd: 0, runId: null, error };
      }
      if (onResult) await onResult(out, b.id);
    }
    await db.update(batches).set({ status: "collected", endedAt, collectedAt: now }).where(and(eq(batches.id, b.id)));
    collected += 1;
  }
  return { checked: open.length, collected, results };
}
