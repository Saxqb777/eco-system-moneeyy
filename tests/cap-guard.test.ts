import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setAnthropicFactory } from "@/agents/client";
import { estimateTaskUsd, inFlightUsd, RESEARCH_TASK_USD, WRITING_TASK_USD } from "@/agents/spend-guard";
import { submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { agents, budgetLedger, floors, setupItems, tasks, wardenRuns } from "@/db/schema";
import { guardSpend } from "@/lib/budget";
import { encryptSecret } from "@/lib/crypto";
import { minutesToDubaiMidnight, runReport } from "@/lib/run-summary";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { runWarden } from "@/warden/decide";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let fake: ReturnType<typeof fakeAnthropic>;
const NOW = new Date("2026-10-06T15:00:00Z"); // 19:00 Dubai

async function spend(usd: number) {
  await db.insert(budgetLedger).values({ kind: "api_cost", amountUsd: usd.toFixed(6), simulated: false, occurredAt: NOW, createdAt: NOW });
}

async function floorBySlug(slug: string) {
  const [f] = await db.select().from(floors).where(eq(floors.slug, slug)).limit(1);
  return f!;
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  fake = fakeAnthropic(() => ({}));
  setAnthropicFactory(() => fake);
  await setSetting(db, "simulation_mode", false);
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret("sk-ant-test"), hint: "set" }).where(eq(setupItems.key, "anthropic_api_key"));
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  if (close) await close();
});

beforeEach(async () => {
  await db.delete(budgetLedger);
  await db.delete(tasks);
  await db.delete(wardenRuns);
  await setSetting(db, "daily_cap_usd", 1.7);
  await db.update(floors).set({ status: "live", pausedReason: null, throttledUntil: null }).where(eq(floors.slug, "docledger"));
  await db.update(floors).set({ status: "live", pausedReason: null, throttledUntil: null }).where(eq(floors.slug, "growth"));
});

describe("The cap pause lifts itself", () => {
  it("pauses business floors at the cap and brings them back once the cap is raised, but never an owner pause", async () => {
    await spend(1.75);
    const hit = await guardSpend(db, NOW);
    expect(hit.capHit).toBe(true);
    expect((await floorBySlug("docledger")).status).toBe("paused");
    expect((await floorBySlug("growth")).pausedReason).toMatch(/^Daily cap of 1\.70/);

    // the owner pauses growth himself meanwhile
    await db.update(floors).set({ pausedReason: "Paused by the owner" }).where(eq(floors.slug, "growth"));
    await setSetting(db, "daily_cap_usd", 2);
    const after = await guardSpend(db, NOW);
    expect(after.capHit).toBe(false);
    expect(after.resumedFloors).toEqual(["docledger"]);
    expect((await floorBySlug("docledger")).status).toBe("live");
    expect((await floorBySlug("docledger")).pausedReason).toBeNull();
    expect((await floorBySlug("growth")).status).toBe("paused");
  });

  it("brings cap paused floors back on a new Dubai day", async () => {
    await spend(1.8);
    await guardSpend(db, NOW);
    expect((await floorBySlug("docledger")).status).toBe("paused");
    const nextDay = new Date("2026-10-06T20:30:00Z"); // 00:30 Dubai on the 7th
    const res = await guardSpend(db, nextDay);
    expect(res.todayUsd).toBe(0);
    expect(res.resumedFloors.sort()).toEqual(["docledger", "growth"]);
  });
});

describe("Work in flight counts against the cap", () => {
  it("estimates research above writing", () => {
    expect(estimateTaskUsd("qualify_lead")).toBe(RESEARCH_TASK_USD);
    expect(estimateTaskUsd("draft_outreach")).toBe(WRITING_TASK_USD);
  });

  it("does not start new work when billed spend plus the work in flight fills the cap", async () => {
    const floor = await floorBySlug("docledger");
    const [analyst] = await db.select().from(agents).where(eq(agents.name, "Analyst")).limit(1);
    const [writer] = await db.select().from(agents).where(eq(agents.name, "Writer")).limit(1);
    await spend(1.5);
    // three research tasks already in a batch: 0.24 reserved, so 1.74 of 1.70
    for (let i = 0; i < 3; i++) await db.insert(tasks).values({ floorId: floor.id, agentId: analyst!.id, kind: "qualify_lead", title: `Qualify ${i}`, status: "running", startedAt: NOW, batchId: "b1", simulated: false });
    const reserved = await inFlightUsd(db, NOW);
    expect(reserved.totalUsd).toBeCloseTo(0.24, 5);
    await db.insert(tasks).values({ floorId: floor.id, agentId: writer!.id, kind: "draft_outreach", title: "Draft outreach email", status: "queued", simulated: false });
    const res = await submitQueuedTasks(db, NOW);
    expect(res.submitted).toBe(0);
    expect(res.status).toBe("held");
    expect(res.reason).toBe("daily cap reached");
  });

  it("says which floors are paused when their queued work cannot start", async () => {
    const floor = await floorBySlug("docledger");
    const [writer] = await db.select().from(agents).where(eq(agents.name, "Writer")).limit(1);
    await db.update(floors).set({ status: "paused", pausedReason: "Paused by the owner" }).where(eq(floors.id, floor.id));
    await db.insert(tasks).values({ floorId: floor.id, agentId: writer!.id, kind: "draft_outreach", title: "Draft outreach email", status: "queued", simulated: false });
    const res = await submitQueuedTasks(db, NOW);
    expect(res.paused).toEqual(["docledger"]);
    expect(res.reason).toBe("floors paused: docledger");
  });

  it("holds Warden when his run would pass the cap, before any model call", async () => {
    await spend(1.62);
    const calls = fake.calls.length;
    const res = await runWarden(db, { mode: "sync", trigger: "manual", now: NOW });
    expect(res.status).toBe("held");
    expect(res.reason).toMatch(/daily cap reached: 1\.62 of 1\.70/);
    expect(fake.calls.length).toBe(calls);
    expect(await db.select().from(wardenRuns)).toHaveLength(0);
  });
});

describe("The Run the Tower now answer", () => {
  it("counts the minutes to midnight in Dubai", () => {
    expect(minutesToDubaiMidnight(new Date("2026-09-30T19:05:00Z"))).toBe(55);
    expect(minutesToDubaiMidnight(new Date("2026-09-30T20:00:00Z"))).toBe(24 * 60);
  });

  it("says the cap stopped the run, when work starts again and what waits on the owner", () => {
    const r = runReport(
      {
        guard: { capHit: true, capUsd: 1.7, todayUsd: 1.86 },
        submit: { status: "held", reason: "daily cap reached", submitted: 0 },
        warden: { status: "held", reason: "daily cap reached: 1.86 of 1.70 USD spent" },
        owner: { approvals: 2 },
      },
      new Date("2026-09-30T19:05:00Z"),
    );
    expect(r.capped).toBe(true);
    expect(r.headline).toBe("Daily cap reached");
    expect(r.lines.join(" ")).toBe("Daily cap reached: 1.86 of 1.70 USD spent today. Work starts again at midnight Dubai, in 55 min. To go on now, raise the daily cap in the Budget tab. 2 items wait for you on the red phone.");
  });

  it("names floors that came back and the work that started", () => {
    const r = runReport({ guard: { capHit: false, resumedFloors: ["docledger", "growth"] }, submit: { submitted: 3, direct: 1 }, warden: { status: "skipped", reason: "an instant run for manual already happened this hour" } });
    expect(r.headline).toBe("3 tasks at work");
    expect(r.lines[0]).toBe("DocLedger Sales and DocLedger Growth are back at work.");
    expect(r.lines[1]).toBe("Floors: 3 tasks worked, 1 finished already.");
    expect(r.lines.join(" ")).not.toMatch(/[—–]| - /);
  });

  it("points at the Resume button for a floor the owner paused", () => {
    const r = runReport({ submit: { status: "held", reason: "floors paused: docledger", paused: ["docledger"] } });
    expect(r.lines).toContain("DocLedger Sales is paused: open the floor and tap Resume.");
  });
});
