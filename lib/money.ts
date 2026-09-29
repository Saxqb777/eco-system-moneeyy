import { BATCH_MULTIPLIER, PRICES_USD_PER_MTOK, WEB_SEARCH_USD } from "@/config/models";

export interface UsageLike {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearches?: number;
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// Cost of one model call in USD. Batch mode halves every token rate. Web searches are flat.
export function computeCostUsd(model: string, u: UsageLike, mode: "sync" | "batch" = "sync"): number {
  const p = PRICES_USD_PER_MTOK[model];
  if (!p) throw new Error(`No price configured for model ${model}`);
  const m = mode === "batch" ? BATCH_MULTIPLIER : 1;
  const tokens =
    ((u.inputTokens * p.input +
      u.outputTokens * p.output +
      (u.cacheReadTokens ?? 0) * p.cacheRead +
      (u.cacheWriteTokens ?? 0) * p.cacheWrite5m) /
      1_000_000) *
    m;
  const search = (u.webSearches ?? 0) * WEB_SEARCH_USD;
  return round6(tokens + search);
}

export function formatUsd(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  return v.toFixed(2);
}
