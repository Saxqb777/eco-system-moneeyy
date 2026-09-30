import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, floors } from "@/db/schema";
import type { Db } from "@/db/client";
import { buildBrief } from "@/lib/brief";
import { getAgentDetail, getFloorDetail, getWardenSummary, renameAgent, setFloorPaused } from "@/lib/detail";
import { validateAgentName } from "@/lib/tasks";
import { runSimulation } from "@/sim/generator";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;

// 12:00 Dubai on a Tuesday, three hours of simulated activity behind it.
const NOON = new Date("2026-09-29T08:00:00Z");

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  await runSimulation(db, NOON, { maxSlices: 72 });
}, 60_000);

afterAll(async () => {
  if (close) await close();
});

describe("panel data on a real schema", () => {
  it("describes a worker with history, log and cost today", async () => {
    const [scout] = await db.select().from(agents).where(eq(agents.slug, "docledger_scout")).limit(1);
    const d = await getAgentDetail(db, scout!.id, NOON);
    expect(d).not.toBeNull();
    expect(d!.floor?.slug).toBe("docledger");
    expect(d!.simulated).toBe(true);
    expect(d!.history.length).toBeGreaterThan(0);
    expect(d!.log.length).toBeGreaterThan(0);
    // oldest first so the panel reads top to bottom
    const times = d!.log.map((e) => e.createdAt);
    expect([...times].sort()).toEqual(times);
    const finished = d!.history.filter((h) => h.status === "done");
    if (finished.length) {
      expect(d!.today.runs).toBeGreaterThan(0);
      expect(d!.today.costUsd).toBeGreaterThan(0);
      expect(finished[0]!.summary).toMatch(/Found \d+ new leads/);
    }
  });

  it("returns null for an unknown worker", async () => {
    expect(await getAgentDetail(db, "00000000-0000-0000-0000-000000000000", NOON)).toBeNull();
  });

  it("renames a worker with a checked name", async () => {
    const [writer] = await db.select().from(agents).where(eq(agents.slug, "docledger_writer")).limit(1);
    expect(await renameAgent(db, writer!.id, "  Maya   Writer ", NOON)).toEqual({ ok: true, name: "Maya Writer" });
    const [after] = await db.select().from(agents).where(eq(agents.id, writer!.id)).limit(1);
    expect(after!.name).toBe("Maya Writer");
    expect(await renameAgent(db, writer!.id, "x", NOON)).toMatchObject({ ok: false });
    expect(validateAgentName("<script>")).toMatchObject({ ok: false });
    expect(validateAgentName("A name that is far too long for a plate")).toMatchObject({ ok: false });
    expect(validateAgentName("O'Neil 2")).toEqual({ ok: true, name: "O'Neil 2" });
  });

  it("describes a floor with weekly numbers, crew and money", async () => {
    const d = await getFloorDetail(db, "docledger", NOON);
    expect(d).not.toBeNull();
    expect(d!.agents.map((a) => a.slug)).toContain("docledger_scout");
    expect(d!.weeklyTarget).toBe(1);
    expect(d!.measure).toMatch(/Demos booked/);
    expect(d!.money.spendWeekUsd).toBeGreaterThanOrEqual(d!.money.spendTodayUsd);
    expect(d!.missingSetup.map((m) => m.key)).toContain("calendar_link");
    const locked = await getFloorDetail(db, "content", NOON);
    expect(locked!.status).toBe("locked");
    expect(locked!.activeTasks).toEqual([]);
    expect(await getFloorDetail(db, "nowhere", NOON)).toBeNull();
  });

  it("pauses and resumes a floor, parking and waking its crew", async () => {
    expect(await setFloorPaused(db, "growth", true, NOON)).toEqual({ ok: true, status: "paused" });
    const [paused] = await db.select().from(floors).where(eq(floors.slug, "growth")).limit(1);
    expect(paused!.status).toBe("paused");
    expect(paused!.pausedReason).toMatch(/owner/);
    const crew = await db.select().from(agents).where(eq(agents.floorId, paused!.id));
    expect(crew.every((a) => a.status === "paused" || a.status === "blocked" || a.status === "helping")).toBe(true);

    expect(await setFloorPaused(db, "growth", false, NOON)).toEqual({ ok: true, status: "live" });
    const [live] = await db.select().from(floors).where(eq(floors.slug, "growth")).limit(1);
    expect(live!.status).toBe("live");
    expect(live!.pausedReason).toBeNull();
    const woke = await db.select().from(agents).where(eq(agents.floorId, live!.id));
    for (const a of woke) expect(a.status === "paused").toBe(false);
    for (const a of woke) if (a.currentTaskId && a.status !== "blocked") expect(a.status).toBe("working");

    expect(await setFloorPaused(db, "content", true, NOON)).toMatchObject({ ok: false });
  });

  it("builds the brief from data, one line per floor", async () => {
    const b = await buildBrief(db, NOON);
    expect(b.dayKey).toBe("2026-09-29");
    expect(b.simulated).toBe(true);
    expect(b.floors.map((f) => f.slug)).toEqual(["penthouse", "docledger", "growth", "content", "service", "lobby"]);
    expect(b.floors.find((f) => f.slug === "content")!.line).toMatch(/Unlocks/);
    expect(b.needs.some((n) => /Anthropic API key/.test(n))).toBe(true);
    expect(b.moneyOutTodayUsd).toBeGreaterThan(0);
    expect(b.netTodayUsd).toBeCloseTo(b.moneyInTodayUsd - b.moneyOutTodayUsd, 6);
    for (const line of [...b.needs, ...b.floors.map((f) => f.line)]) expect(line).not.toMatch(/[—–]/);
  });

  it("summarises the Warden's desk", async () => {
    const w = await getWardenSummary(db, NOON);
    expect(w.budget.dailyCapUsd).toBe(1.7);
    expect(w.budget.level).toBe(1);
    expect(w.budget.spendTodayUsd).toBeCloseTo(w.budget.todayByFloor.reduce((a, f) => a + f.usd, 0), 6);
    expect(w.missingSetup.length).toBeGreaterThan(0);
    expect(w.brief.floors).toHaveLength(6);
  });
});
