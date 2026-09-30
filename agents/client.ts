// The one wrapper every model call goes through. Logs agent, model, tokens, cache hits, cost, duration and task id.
// Rule 4: no call happens in simulation mode. Rule 2: the tick's guard decides whether a call may start at all.
import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageCreateParamsNonStreaming, MessageParam } from "@anthropic-ai/sdk/resources/messages/messages";
import { eq } from "drizzle-orm";
import { CACHE_SYSTEM_PROMPT, EFFORT, resolveModel, type AgentModelKey, type Effort } from "@/config/models";
import type { Db } from "@/db/client";
import { agentRuns, budgetLedger, setupItems } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { computeCostUsd, type UsageLike } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export interface ModelCall {
  agentKey: AgentModelKey;
  agentId: string | null;
  taskId?: string | null;
  floorId?: string | null;
  system: string;
  messages: MessageParam[];
  schema?: Record<string, unknown>;
  maxTokens?: number;
  webSearchMaxUses?: number;
  webFetchMaxUses?: number;
  customId?: string;
  // Overrides the agent kind's default effort (research playbooks use RESEARCH_EFFORT).
  effort?: Effort;
}

export interface ModelResult {
  runId: string | null;
  model: string;
  text: string;
  json: unknown;
  usage: UsageLike;
  costUsd: number;
  durationMs: number;
  stopReason: string | null;
}

// A tiny surface so tests can hand in a fake without the network.
export interface AnthropicLike {
  messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<Message>;
    batches: {
      create(params: { requests: Array<{ custom_id: string; params: MessageCreateParamsNonStreaming }> }): Promise<{ id: string; processing_status: string; request_counts?: unknown }>;
      retrieve(id: string): Promise<{ id: string; processing_status: string; ended_at: string | null; request_counts?: unknown }>;
      results(id: string): Promise<AsyncIterable<{ custom_id: string; result: { type: string; message?: Message; error?: unknown } }>>;
    };
  };
}

let factory: (apiKey: string) => AnthropicLike = (apiKey) => new Anthropic({ apiKey }) as unknown as AnthropicLike;
const clients = new Map<string, AnthropicLike>();

// Tests inject a fake here. Production never calls this.
export function setAnthropicFactory(f: ((apiKey: string) => AnthropicLike) | null) {
  factory = f ?? ((apiKey) => new Anthropic({ apiKey }) as unknown as AnthropicLike);
  clients.clear();
}

export async function getAnthropicKey(db: Db): Promise<string | null> {
  const [row] = await db.select().from(setupItems).where(eq(setupItems.key, "anthropic_api_key")).limit(1);
  if (row?.status === "present" && row.valueEncrypted) {
    try {
      return decryptSecret(row.valueEncrypted);
    } catch {
      return null;
    }
  }
  return process.env.ANTHROPIC_API_KEY ?? null;
}

export async function getClient(db: Db): Promise<AnthropicLike | null> {
  const key = await getAnthropicKey(db);
  if (!key) return null;
  const cacheKey = key.slice(-8);
  let c = clients.get(cacheKey);
  if (!c) {
    c = factory(key);
    clients.set(cacheKey, c);
  }
  return c;
}

export async function modelFor(db: Db, agentKey: AgentModelKey): Promise<string> {
  const s = await getSettings(db);
  return resolveModel(agentKey, (s.model_overrides ?? null) as Partial<Record<AgentModelKey, string>> | null);
}

// Request body shared by sync calls and batch requests. Structured output when a schema is given.
export function buildParams(call: ModelCall, model: string): MessageCreateParamsNonStreaming {
  const cache = CACHE_SYSTEM_PROMPT[call.agentKey];
  const params: MessageCreateParamsNonStreaming = {
    model,
    max_tokens: call.maxTokens ?? 2048,
    system: [{ type: "text", text: call.system, ...(cache ? { cache_control: { type: "ephemeral" } } : {}) }],
    messages: call.messages,
    output_config: { effort: call.effort ?? EFFORT[call.agentKey], ...(call.schema ? { format: { type: "json_schema", schema: call.schema } } : {}) },
  };
  const tools: NonNullable<MessageCreateParamsNonStreaming["tools"]> = [];
  if (call.webSearchMaxUses && call.webSearchMaxUses > 0) tools.push({ type: "web_search_20260318", name: "web_search", max_uses: call.webSearchMaxUses });
  if (call.webFetchMaxUses && call.webFetchMaxUses > 0) tools.push({ type: "web_fetch_20260318", name: "web_fetch", max_uses: call.webFetchMaxUses, max_content_tokens: 12000 });
  if (tools.length) params.tools = tools;
  return params;
}

export function usageOf(message: Message): UsageLike {
  const u = message.usage;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    webSearches: u.server_tool_use?.web_search_requests ?? 0,
  };
}

export function textOf(message: Message): string {
  return message.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Writes the agent_runs row and the ledger row. Every call, sync or batch, lands here.
export async function recordRun(
  db: Db,
  input: { call: Pick<ModelCall, "agentId" | "taskId" | "floorId" | "customId">; model: string; mode: "sync" | "batch"; usage: UsageLike; durationMs: number | null; stopReason: string | null; batchId?: string | null; error?: string | null; startedAt: Date; finishedAt: Date },
): Promise<{ runId: string; costUsd: number }> {
  const costUsd = input.error ? 0 : computeCostUsd(input.model, input.usage, input.mode);
  const [run] = await db
    .insert(agentRuns)
    .values({
      agentId: input.call.agentId,
      taskId: input.call.taskId ?? null,
      floorId: input.call.floorId ?? null,
      model: input.model,
      mode: input.mode,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      cacheReadTokens: input.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: input.usage.cacheWriteTokens ?? 0,
      webSearchCount: input.usage.webSearches ?? 0,
      costUsd: costUsd.toFixed(6),
      durationMs: input.durationMs,
      stopReason: input.stopReason,
      batchId: input.batchId ?? null,
      customId: input.call.customId ?? null,
      error: input.error ?? null,
      simulated: false,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    })
    .returning({ id: agentRuns.id });
  if (costUsd > 0) {
    await db.insert(budgetLedger).values({
      kind: "api_cost",
      amountUsd: costUsd.toFixed(6),
      floorId: input.call.floorId ?? null,
      agentId: input.call.agentId,
      taskId: input.call.taskId ?? null,
      agentRunId: run?.id ?? null,
      note: `${input.model} ${input.mode}${input.usage.webSearches ? `, ${input.usage.webSearches} searches` : ""}`,
      simulated: false,
      occurredAt: input.finishedAt,
      createdAt: input.finishedAt,
    });
  }
  return { runId: run?.id ?? "", costUsd };
}

// One synchronous call. Throws when there is no key: callers check simulation mode and the key first.
export async function callModel(db: Db, call: ModelCall, now = new Date()): Promise<ModelResult> {
  const client = await getClient(db);
  if (!client) throw new Error("No Anthropic API key on the clipboard");
  const model = await modelFor(db, call.agentKey);
  const params = buildParams(call, model);
  const startedAt = now;
  const t0 = Date.now();
  try {
    const message = await client.messages.create(params);
    const durationMs = Date.now() - t0;
    const usage = usageOf(message);
    const finishedAt = new Date();
    const { runId, costUsd } = await recordRun(db, { call, model, mode: "sync", usage, durationMs, stopReason: message.stop_reason ?? null, startedAt, finishedAt });
    const text = textOf(message);
    return { runId, model, text, json: call.schema ? parseJson(text) : null, usage, costUsd, durationMs, stopReason: message.stop_reason ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun(db, { call, model, mode: "sync", usage: { inputTokens: 0, outputTokens: 0 }, durationMs: Date.now() - t0, stopReason: null, error: message, startedAt, finishedAt: new Date() });
    throw err;
  }
}
