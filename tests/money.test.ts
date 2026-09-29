import { describe, expect, it } from "vitest";
import { computeCostUsd } from "@/lib/money";

describe("computeCostUsd", () => {
  it("prices a sonnet call from the config table", () => {
    // 10k in at 2 USD per MTok = 0.02, 1k out at 10 = 0.01
    expect(computeCostUsd("claude-sonnet-5-5", { inputTokens: 10_000, outputTokens: 1_000 })).toBeCloseTo(0.03, 6);
  });
  it("halves token cost in batch mode but not web searches", () => {
    const sync = computeCostUsd("claude-opus-5-5", { inputTokens: 10_000, outputTokens: 1_000, webSearches: 2 });
    const batch = computeCostUsd("claude-opus-5-5", { inputTokens: 10_000, outputTokens: 1_000, webSearches: 2 }, "batch");
    expect(sync).toBeCloseTo(0.04 + 0.02 + 0.02, 6);
    expect(batch).toBeCloseTo(0.03 + 0.02, 6);
  });
  it("counts cache reads and writes at their own rates", () => {
    const cost = computeCostUsd("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.2 + 2.5, 6);
  });
  it("refuses unknown models", () => {
    expect(() => computeCostUsd("claude-unknown", { inputTokens: 1, outputTokens: 1 })).toThrow();
  });
});
