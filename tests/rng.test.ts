import { describe, expect, it } from "vitest";
import { between, pick, rngFor } from "@/sim/rng";

describe("seeded rng", () => {
  it("is deterministic for the same seed", () => {
    const a = rngFor("slice", "2026-09-29T10:00:00.000Z", "docledger_scout");
    const b = rngFor("slice", "2026-09-29T10:00:00.000Z", "docledger_scout");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("stays inside bounds", () => {
    const r = rngFor("x");
    for (let i = 0; i < 200; i++) {
      const v = between(r, 3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
    expect(["a", "b"]).toContain(pick(r, ["a", "b"]));
  });
});
