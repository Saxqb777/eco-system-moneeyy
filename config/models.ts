// The only place where model names live. Switchable per agent.
// Every price here is USD per million tokens (from the Claude API reference, 2026-09).

export type AgentModelKey = "warden" | "worker" | "builder";

export const MODELS: Record<AgentModelKey, string> = {
  warden: "claude-opus-5-5",
  worker: "claude-sonnet-5-5",
  builder: "claude-sonnet-5-5",
};

export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheRead: number;
}

export const PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite5m: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.2 },
};

// Batch API: half price on every token type.
export const BATCH_MULTIPLIER = 0.5;

// Server side web search: 10 USD per 1,000 searches.
export const WEB_SEARCH_USD = 0.01;

export type Effort = "low" | "medium" | "high";

export const EFFORT: Record<AgentModelKey, Effort> = {
  warden: "medium",
  worker: "low",
  builder: "medium",
};

// Research playbooks (Scouts, Analyst, share spots) think a little more: at low effort they often answered
// without a single web search (2026-09-30 clean run). Writing stays at the worker default.
export const RESEARCH_EFFORT: Effort = "medium";

// Prompt caching per agent kind. Warden's scheduled runs are 4 hours apart, so the
// 5 minute cache expires between them and the write would only cost more (decision D008, question 6).
export const CACHE_SYSTEM_PROMPT: Record<AgentModelKey, boolean> = {
  warden: false,
  worker: true,
  builder: true,
};

export function resolveModel(
  key: AgentModelKey,
  overrides?: Partial<Record<AgentModelKey, string>> | null,
): string {
  const override = overrides?.[key];
  return override && override in PRICES_USD_PER_MTOK ? override : MODELS[key];
}
