import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAnthropicFactory } from "@/agents/client";
import { submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { agents, floors, leads, outreach, setupItems, taskEvents, tasks } from "@/db/schema";
import { setPageFetch } from "@/lib/contact-finder";
import { encryptSecret } from "@/lib/crypto";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const MORNING = new Date("2026-10-06T06:00:00Z");
let codeSeq = 0;

async function addLead(company: string, status: string) {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [lead] = await db
    .insert(leads)
    .values({ floorId: floor!.id, company, dedupeKey: company.toLowerCase().replace(/\s+/g, "-"), website: `https://${company.toLowerCase().replace(/\s+/g, "")}.example`, segment: "freight_forwarder", city: "Dubai", country: "AE", score: 8, status, decisionMaker: { name: "Sara Contact", title: "Finance Manager", email: `sara@${company.toLowerCase().replace(/\s+/g, "")}.example` }, previewCode: `s${(++codeSeq).toString(36)}stale`, simulated: false })
    .returning();
  return lead!;
}

async function queue(kind: "qualify_lead" | "draft_outreach", leadId: string, agentSlug: string) {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [agent] = await db.select().from(agents).where(eq(agents.slug, agentSlug)).limit(1);
  const [t] = await db.insert(tasks).values({ floorId: floor!.id, agentId: agent!.id, kind, title: `${kind} redo`, status: "queued", priority: 3, input: { leadId }, simulated: false, createdAt: MORNING, updatedAt: MORNING }).returning();
  return t!;
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  setPageFetch(async () => ({ ok: false, status: 404, html: "" }));
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  await setSetting(db, "simulation_mode", false);
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret("sk-ant-test"), hint: "set" }).where(eq(setupItems.key, "anthropic_api_key"));
  await db.update(floors).set({ status: "live" }).where(eq(floors.slug, "docledger"));
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setPageFetch(null);
  if (close) await close();
});

describe("stale tasks never reach the model (D083)", () => {
  it("closes a qualify or a first draft for a lead that already moved on, and lets a fresh one through", async () => {
    const fake = fakeAnthropic(() => ({ score: 7, reason: "fits", qualified: true, decisionMaker: { name: "Sara Contact", title: "Finance Manager", email: "sara@fresh.example", linkedin: "" }, research: [], angle: "shipping bills", approach: "open with their routes", website: "https://fresh.example", notes: "" }));
    setAnthropicFactory(() => fake);
    const replied = await addLead("Replied Freight", "replied");
    const paying = await addLead("Paying Freight", "client");
    const emailed = await addLead("Emailed Freight", "qualified");
    await db.insert(outreach).values({ leadId: emailed.id, step: 1, subject: "Your bills", bodyText: "Hi", status: "sent", sentAt: MORNING, simulated: false, createdAt: MORNING, updatedAt: MORNING });
    const fresh = await addLead("Fresh Freight", "new");
    const t1 = await queue("qualify_lead", replied.id, "docledger_analyst");
    const t2 = await queue("draft_outreach", paying.id, "docledger_writer");
    const t3 = await queue("draft_outreach", emailed.id, "docledger_writer");
    const t4 = await queue("qualify_lead", fresh.id, "docledger_analyst");

    const r = await submitQueuedTasks(db, MORNING);
    expect(r.skipped).toBeGreaterThanOrEqual(3);
    const rows = await db.select().from(tasks).where(and(eq(tasks.simulated, false), eq(tasks.floorId, t1.floorId!)));
    const byId = new Map(rows.map((x) => [x.id, x]));
    expect(byId.get(t1.id)!.status).toBe("done");
    expect((byId.get(t1.id)!.output as { note: string }).note).toContain("already replied");
    expect(byId.get(t2.id)!.status).toBe("done");
    expect((byId.get(t2.id)!.output as { note: string }).note).toContain("already client");
    expect(byId.get(t3.id)!.status).toBe("done");
    expect((byId.get(t3.id)!.output as { note: string }).note).toContain("first email already went out");
    // the fresh lead's qualify is real work: it went to the model (batch or direct), not closed
    expect(["in_batch", "running", "done", "review"]).toContain(byId.get(t4.id)!.status);
    expect(fake.calls.length + [...fake.batches.values()].reduce((n, b) => n + b.length, 0)).toBe(1);
    const notes = await db.select().from(taskEvents).where(eq(taskEvents.type, "done"));
    expect(notes.filter((e) => e.message.includes("nothing to redo") || e.message.includes("nothing to draft"))).toHaveLength(3);
  });
});
