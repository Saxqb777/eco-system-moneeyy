import { describe, expect, it } from "vitest";
import { LINES, newsText } from "@/scene/lines";
import { runReport } from "@/lib/run-summary";
import { sequence, TweenRunner, until, wait } from "@/scene/tween";

const DASH = /[\u2014\u2013-]/;

describe("What the people in the building say", () => {
  it("never uses a dash (rule 7)", () => {
    const all = Object.values(LINES).flatMap((v) => (Array.isArray(v) ? v : [v]));
    expect(all.length).toBeGreaterThan(40);
    for (const line of all) expect(line, line).not.toMatch(DASH);
  });
});

describe("The LED sign in the plaza", () => {
  it("turns dashes into commas, shouts, and separates items with dots", () => {
    const text = newsText(["Scout found 5 leads \u2014 Dubai", "Writer drafted TLM - first email", "  ", "Spend today 1.86 of 2.00 USD"]);
    expect(text).toBe("SCOUT FOUND 5 LEADS, DUBAI   \u2022   WRITER DRAFTED TLM, FIRST EMAIL   \u2022   SPEND TODAY 1.86 OF 2.00 USD");
    expect(text).not.toMatch(/[\u2014\u2013]| - /);
  });
});

describe("The banner lines", () => {
  it("stay short and dash free for every kind of run", () => {
    const cases = [
      runReport({ guard: { capHit: true, capUsd: 2, todayUsd: 2.01 } }, new Date("2026-09-30T19:05:00Z")),
      runReport({ submit: { submitted: 2, direct: 0 }, owner: { approvals: 3 } }),
      runReport({ guard: { resumedFloors: ["growth"] } }),
      runReport({ submit: { paused: ["docledger"] } }),
      runReport({ owner: { approvals: 1 } }),
      runReport({}),
    ];
    expect(cases.map((c) => c.headline)).toEqual(["Daily cap reached", "2 tasks at work", "Floors back at work", "Floors paused", "1 waiting on you", "All caught up"]);
    expect(cases[1]!.sub).toBe("3 items on the red phone");
    expect(cases[2]!.sub).toBe("DocLedger Growth");
    for (const c of cases) {
      expect(c.sub.length).toBeLessThan(60);
      expect(`${c.headline} ${c.sub}`).not.toMatch(DASH);
    }
  });
});

describe("The tween runner", () => {
  it("keeps a tween that another tween adds while the runner is running (the lift's next ride, a walk out)", () => {
    const runner = new TweenRunner();
    const log: string[] = [];
    runner.add(sequence([() => wait(100)], () => {
      log.push("first done");
      runner.add(sequence([() => wait(100)], () => log.push("second done")));
    }));
    for (let i = 0; i < 10; i++) runner.update(50);
    expect(log).toEqual(["first done", "second done"]);
    expect(runner.size).toBe(0);
  });

  it("holds a sequence until its cue", () => {
    const runner = new TweenRunner();
    const cue = { go: false };
    let done = false;
    runner.add(sequence([() => until(() => cue.go, 10_000)], () => (done = true)));
    runner.update(1000);
    expect(done).toBe(false);
    cue.go = true;
    runner.update(16);
    expect(done).toBe(true);
  });
});
