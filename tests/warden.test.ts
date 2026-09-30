import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAnthropicFactory } from "@/agents/client";
import { collectBatches } from "@/agents/batches";
import type { Db } from "@/db/client";
import { agentRuns, agents, approvals, budgetLedger, floors, ideas, messagesOut, setupItems, tasks, wardenRuns } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { applyWardenDecisions } from "@/warden/apply";
import { handleWardenBatchResult, runWarden } from "@/warden/decide";
import { parseDecisions } from "@/warden/prompt";
import { buildSnapshot } from "@/warden/snapshot";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const NOW = new Date("2026-10-06T08:00:00Z"); // Tuesday 12:00 Dubai

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  await setSetting(db, "simulation_mode", false);
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret("sk-ant-test"), hint: "ends with test" }).where(eq(setupItems.key, "anthropic_api_key"));
  setTelegramApi(fakeTelegram().api);
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  if (close) await close();
});

const scoutId = async () => (await db.select().from(agents).where(eq(agents.slug, "docledger_scout")).limit(1))[0]!.id;

describe("Warden real loop", () => {
  it("parses a decision object tolerantly", () => {
    const d = parseDecisions({ summary: "ok", assignments: [{ agent: "docledger_scout", kind: "find_leads", title: "Find forwarders", priority: 99 }, { bad: true }], reviews: "nope" });
    expect(d?.assignments).toHaveLength(1);
    expect(d?.assignments[0]?.priority).toBe(9);
    expect(d?.reviews).toEqual([]);
    expect(parseDecisions(null)).toBeNull();
  });

  it("builds a compact snapshot", async () => {
    const s = await buildSnapshot(db, NOW);
    expect(s.floors.map((f) => f.slug)).toContain("docledger");
    expect(s.floors.find((f) => f.slug === "lobby")).toBeUndefined();
    expect(s.budget.dailyCapUsd).toBe(1.7);
    expect(JSON.stringify(s).length).toBeLessThan(16000);
  });

  it("applies assignments, notes, ideas, approvals and messages", async () => {
    const [idea] = await db.insert(ideas).values({ text: "Try Sharjah forwarders", source: "telegram", status: "new" }).returning();
    const out = await applyWardenDecisions(
      db,
      "run-test",
      {
        summary: "Queued a scout run and noted the idea.",
        assignments: [
          { agent: "docledger_scout", kind: "find_leads", title: "Find forwarders", priority: 5, input: "Jebel Ali first" },
          { agent: "content_nobody", kind: "x", title: "x", priority: 5, input: "" },
        ],
        reviews: [],
        strategyNotes: [{ floor: "docledger", note: "Lead with customs delays." }, { floor: "nowhere", note: "x" }],
        ideaActions: [{ ideaId: idea!.id, action: "ticket", floor: "docledger", reply: "Added to the backlog.", ticketTitle: "Sharjah free zone list" }],
        budgetMoves: [{ from: "buffer", to: "web_search", usd: 2 }],
        approvalsToRaise: [{ type: "decision", summary: "Open a second niche?", riskNote: "None", content: "Customs brokers reply faster." }],
        messagesToOwner: ["Two demos are close."],
        blockedResolutions: [],
      },
      NOW,
    );
    expect(out.assigned).toBe(1);
    expect(out.notes).toBe(1);
    expect(out.ideas).toBe(1);
    expect(out.moves).toBe(1);
    expect(out.approvals).toBe(1);
    expect(out.skipped.length).toBe(2);
    const queued = await db.select().from(tasks).where(and(eq(tasks.agentId, await scoutId()), eq(tasks.status, "queued")));
    expect(queued.some((t) => t.title === "Find forwarders" && !t.simulated)).toBe(true);
    const [f] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    expect(f!.strategyNote).toBe("Lead with customs delays.");
    const [i] = await db.select().from(ideas).where(eq(ideas.id, idea!.id)).limit(1);
    expect(i!.status).toBe("ticketed");
    expect(i!.ticketId).toBeTruthy();
    const pending = await db.select().from(approvals).where(and(eq(approvals.status, "pending"), eq(approvals.simulated, false)));
    expect(pending.some((a) => a.type === "decision")).toBe(true);
    const queue = await db.select().from(messagesOut);
    expect(queue.some((m) => m.kind === "approval")).toBe(true);
    expect(queue.some((m) => m.kind === "idea_reply")).toBe(true);
    expect(queue.some((m) => m.kind === "warden_note")).toBe(true);
  });

  it("sends no rework back to a closed floor", async () => {
    const scout = await scoutId();
    const [deals] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    await db.update(floors).set({ status: "archived" }).where(eq(floors.id, deals!.id));
    const [bad] = await db.insert(tasks).values({ floorId: deals!.id, agentId: scout, kind: "find_deals", title: "Closed floor work", status: "review", output: {}, simulated: false }).returning();
    await applyWardenDecisions(db, "run-test-closed", { summary: "Reviewed", assignments: [], reviews: [{ taskId: bad!.id, score: 2, reason: "Nothing found", decision: "reject" }], strategyNotes: [], ideaActions: [], budgetMoves: [], approvalsToRaise: [], messagesToOwner: [], blockedResolutions: [] }, NOW);
    expect(await db.select().from(tasks).where(eq(tasks.parentTaskId, bad!.id))).toHaveLength(0);
    await db.update(floors).set({ status: "live" }).where(eq(floors.id, deals!.id));
  });

  it("reviews finished work: accept and reject with a requeue", async () => {
    const scout = await scoutId();
    const [good] = await db.insert(tasks).values({ agentId: scout, kind: "find_leads", title: "Good work", status: "review", output: { found: 5 }, simulated: false }).returning();
    const [bad] = await db.insert(tasks).values({ agentId: scout, kind: "find_leads", title: "Weak work", status: "review", output: { found: 0 }, simulated: false }).returning();
    const out = await applyWardenDecisions(db, "run-test-2", { summary: "Reviewed", assignments: [], reviews: [{ taskId: good!.id, score: 8, reason: "Solid list", decision: "accept" }, { taskId: bad!.id, score: 3, reason: "Nothing found, widen the search", decision: "reject" }], strategyNotes: [], ideaActions: [], budgetMoves: [], approvalsToRaise: [], messagesToOwner: [], blockedResolutions: [] }, NOW);
    expect(out.accepted).toBe(1);
    expect(out.rejected).toBe(1);
    const [g] = await db.select().from(tasks).where(eq(tasks.id, good!.id)).limit(1);
    expect(g!.status).toBe("done");
    expect(g!.reviewScore).toBe(8);
    const redo = await db.select().from(tasks).where(eq(tasks.parentTaskId, bad!.id));
    expect(redo).toHaveLength(1);
    expect(redo[0]!.feedback).toBe("Nothing found, widen the search");
    const [a] = await db.select().from(agents).where(eq(agents.id, scout)).limit(1);
    expect(a!.reviewCount).toBeGreaterThanOrEqual(2);
  });

  it("runs Warden synchronously through the wrapper and logs the cost", async () => {
    const fake = fakeAnthropic(() => ({ summary: "All floors on pace.", assignments: [], reviews: [], strategyNotes: [], ideaActions: [], budgetMoves: [], approvalsToRaise: [], messagesToOwner: [], blockedResolutions: [] }));
    setAnthropicFactory(() => fake);
    const r = await runWarden(db, { mode: "sync", trigger: "manual", now: NOW });
    expect(r.status).toBe("applied");
    expect(r.summary).toBe("All floors on pace.");
    expect(fake.calls[0]?.output_config?.format?.type).toBe("json_schema");
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.simulated, false));
    expect(runs.length).toBeGreaterThan(0);
    const ledger = await db.select().from(budgetLedger).where(and(eq(budgetLedger.simulated, false), eq(budgetLedger.kind, "api_cost")));
    expect(Number(ledger[0]!.amountUsd)).toBeCloseTo((5000 * 4 + 700 * 20) / 1_000_000, 6);
    // one instant run per hour per trigger
    const again = await runWarden(db, { mode: "sync", trigger: "manual", now: NOW });
    expect(again.status).toBe("skipped");
  });

  it("submits a scheduled run as a batch and applies it on collect", async () => {
    const fake = fakeAnthropic(() => ({ summary: "Batch run applied.", assignments: [], reviews: [], strategyNotes: [{ floor: "deals", note: "Post at 18:00 too." }], ideaActions: [], budgetMoves: [], approvalsToRaise: [], messagesToOwner: [], blockedResolutions: [] }));
    setAnthropicFactory(() => fake);
    const r = await runWarden(db, { mode: "batch", trigger: "schedule", now: NOW });
    expect(r.status).toBe("submitted");
    const [row] = await db.select().from(wardenRuns).where(eq(wardenRuns.id, r.runId!)).limit(1);
    expect(row!.batchId).toMatch(/^msgbatch_/);
    const collected = await collectBatches(db, NOW, async (res) => {
      if (res.customId.startsWith("warden_")) await handleWardenBatchResult(db, res, NOW);
    });
    expect(collected.collected).toBe(1);
    const [after] = await db.select().from(wardenRuns).where(eq(wardenRuns.id, r.runId!)).limit(1);
    expect(after!.status).toBe("applied");
    expect(Number(after!.costUsd)).toBeCloseTo(((5000 * 4 + 700 * 20) / 1_000_000) * 0.5, 6);
    const [deals] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    expect(deals!.strategyNote).toBe("Post at 18:00 too.");
  });

  it("refuses to run in simulation mode or without a key", async () => {
    await setSetting(db, "simulation_mode", true);
    expect((await runWarden(db, { mode: "sync", trigger: "idea", now: NOW })).status).toBe("skipped");
    await setSetting(db, "simulation_mode", false);
    await db.update(setupItems).set({ status: "missing", valueEncrypted: null }).where(eq(setupItems.key, "anthropic_api_key"));
    delete process.env.ANTHROPIC_API_KEY;
    expect((await runWarden(db, { mode: "sync", trigger: "idea", now: NOW })).status).toBe("failed");
  });
});
