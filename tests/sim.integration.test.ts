import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SETUP_ITEMS } from "@/config/tower";
import { agents, approvals, budgetLedger, floors, taskEvents, tasks } from "@/db/schema";
import type { Db } from "@/db/client";
import { getSpendSummary } from "@/lib/budget";
import { getSetting } from "@/lib/settings";
import { getTowerState } from "@/lib/state";
import { applyApprovalDecision, clearSimulationData, runSimulation } from "@/sim/generator";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;

// 12:00 Dubai on a Tuesday: the building is busy.
const NOON = new Date("2026-09-29T08:00:00Z");

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
}, 60_000);

afterAll(async () => {
  if (close) await close();
});

describe("simulation mode on a real schema", () => {
  it("seeds the building", async () => {
    const f = await db.select().from(floors);
    const a = await db.select().from(agents);
    expect(f.map((x) => x.slug).sort()).toEqual(["content", "deals", "docledger", "growth", "lobby", "penthouse", "service"]);
    expect(a).toHaveLength(15);
    expect(a.find((x) => x.slug === "warden")?.locationLevel).toBe(5);
  });

  it("catches up three hours of activity with zero API keys", async () => {
    const summary = await runSimulation(db, NOON, { maxSlices: 72 });
    expect(summary.skipped).toBe(false);
    expect(summary.slices).toBe(36);
    expect(summary.tasksStarted).toBeGreaterThan(0);
    const events = await db.select({ n: sql<number>`count(*)::int` }).from(taskEvents);
    expect(events[0]?.n ?? 0).toBeGreaterThan(0);
    const cursor = await getSetting<string | null>(db, "sim_cursor", null);
    expect(cursor).toBe(NOON.toISOString());
  }, 60_000);

  it("keeps agents and tasks consistent", async () => {
    await runSimulation(db, new Date(NOON.getTime() + 3 * 60 * 60 * 1000), { maxSlices: 72 });
    const rows = await db.select().from(agents);
    for (const a of rows) {
      expect(["idle", "working", "blocked", "helping", "riding", "paused", "offline"]).toContain(a.status);
      expect(a.locationLevel).toBeGreaterThanOrEqual(0);
      expect(a.locationLevel).toBeLessThanOrEqual(5);
      if (a.status === "idle") expect(a.currentTaskId).toBeNull();
      if (a.status === "working" || a.status === "blocked") {
        expect(a.currentTaskId).not.toBeNull();
        const [t] = await db.select().from(tasks).where(eq(tasks.id, a.currentTaskId as string));
        expect(t?.status).toBe(a.status === "blocked" ? "blocked" : "running");
      }
    }
    const warden = rows.find((a) => a.kind === "warden");
    expect(warden).toBeDefined();
    if (warden?.status === "idle") expect(warden.locationLevel).toBe(5);
  }, 60_000);

  it("keeps simulated money out of the real counters", async () => {
    const real = await getSpendSummary(db, false, NOON);
    const simulated = await getSpendSummary(db, true, NOON);
    expect(real.totalSpendUsd).toBe(0);
    expect(real.verifiedRevenueUsd).toBe(0);
    expect(simulated.totalSpendUsd).toBeGreaterThan(0);
    const realRows = await db.select({ n: sql<number>`count(*)::int` }).from(budgetLedger).where(eq(budgetLedger.simulated, false));
    expect(realRows[0]?.n ?? -1).toBe(0);
  });

  it("builds the tower state the UI reads", async () => {
    const state = await getTowerState(db, NOON);
    expect(state.simulationMode).toBe(true);
    expect(state.floors).toHaveLength(6);
    expect(state.floors[0]?.slug).toBe("penthouse");
    expect(state.money.real.netUsd).toBe(0);
    // A closed floor's clipboard items (Deals: 6) are hidden from the game while it is archived.
    expect(state.setup).toHaveLength(SETUP_ITEMS.length - 6);
    expect(state.setup.some((s) => s.key === "deals_channel")).toBe(false);
    // The Deals Engine is archived (D064): not part of the building any more. The Growth floor needs nothing pasted.
    expect(state.floors.find((f) => f.slug === "deals")).toBeUndefined();
    expect(state.floors.find((f) => f.slug === "growth")?.missingSetup).toEqual([]);
    expect(state.floors.find((f) => f.slug === "growth")?.agents).toHaveLength(6);
  });

  it("routes approvals through the queue and back to the agent on reject", async () => {
    // Force a few more hours so drafts exist, then decide one by hand.
    await runSimulation(db, new Date(NOON.getTime() + 8 * 60 * 60 * 1000), { maxSlices: 72 });
    const pending = await db.select().from(approvals).where(eq(approvals.status, "pending"));
    const all = await db.select().from(approvals);
    expect(all.length).toBeGreaterThan(0);
    if (pending[0]) {
      const r = await applyApprovalDecision(db, pending[0].id, "rejected", "Too generic", "ui", NOON);
      expect(r?.status).toBe("rejected");
      const [row] = await db.select().from(approvals).where(eq(approvals.id, pending[0].id));
      expect(row?.feedback).toBe("Too generic");
      expect(row?.decidedVia).toBe("ui");
    }
  }, 60_000);

  it("clears every simulated row on request", async () => {
    await clearSimulationData(db);
    const taskRows = await db.select({ n: sql<number>`count(*)::int` }).from(tasks);
    expect(taskRows[0]?.n ?? -1).toBe(0);
    const ledgerRows = await db.select({ n: sql<number>`count(*)::int` }).from(budgetLedger);
    expect(ledgerRows[0]?.n ?? -1).toBe(0);
    const rows = await db.select().from(agents);
    expect(rows.every((a) => a.status === "idle" && a.currentTaskId === null)).toBe(true);
  });
});
