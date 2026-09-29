import { describe, expect, it } from "vitest";
import { dubaiDayStartUtc, dubaiParts, dubaiWeekStartUtc, isNightInDubai } from "@/lib/time";

describe("dubai time", () => {
  it("shifts by four hours", () => {
    const p = dubaiParts(new Date("2026-09-29T04:00:00Z"));
    expect(p.hour).toBe(8);
    expect(p.dayKey).toBe("2026-09-29");
  });
  it("finds the day start in UTC", () => {
    expect(dubaiDayStartUtc(new Date("2026-09-29T23:30:00Z")).toISOString()).toBe("2026-09-29T20:00:00.000Z");
  });
  it("starts the week on Monday", () => {
    // 2026-10-01 is a Thursday
    expect(dubaiWeekStartUtc(new Date("2026-10-01T10:00:00Z")).toISOString()).toBe("2026-09-27T20:00:00.000Z");
  });
  it("knows night", () => {
    expect(isNightInDubai(new Date("2026-09-29T18:00:00Z"))).toBe(true); // 22:00 Dubai
    expect(isNightInDubai(new Date("2026-09-29T08:00:00Z"))).toBe(false); // 12:00 Dubai
  });
});
