import { describe, expect, it } from "vitest";
import { dubaiHour, skyAt } from "@/scene/sky";
import { ease, sequence, tween, wait } from "@/scene/tween";

describe("sky by Dubai time", () => {
  it("is dark at midnight and bright at noon", () => {
    expect(skyAt(0).darkness).toBe(1);
    expect(skyAt(12).darkness).toBe(0);
    expect(skyAt(12).sunT).not.toBeNull();
    expect(skyAt(0).moonT).not.toBeNull();
  });
  it("sweeps through dawn without jumping", () => {
    const a = skyAt(6.2).darkness;
    const b = skyAt(6.8).darkness;
    const c = skyAt(7.5).darkness;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });
  it("reads the Dubai hour from a UTC date", () => {
    expect(dubaiHour(new Date("2026-09-29T20:30:00Z"))).toBeCloseTo(0.5, 5);
  });
});

describe("tweens", () => {
  it("eases to the end and reports done", () => {
    let v = 0;
    const t = tween(100, (k) => (v = k), ease.linear);
    expect(t.update(50)).toBe(false);
    expect(v).toBeCloseTo(0.5, 5);
    expect(t.update(60)).toBe(true);
    expect(v).toBe(1);
  });
  it("runs a sequence in order", () => {
    const log: string[] = [];
    const s = sequence([() => wait(10), () => tween(10, () => log.push("b"))], () => log.push("done"));
    for (let i = 0; i < 5; i++) s.update(8);
    expect(log[log.length - 1]).toBe("done");
  });
});
