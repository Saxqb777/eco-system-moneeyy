import { and, eq, sql } from "drizzle-orm";
import { setPageFetch } from "@/lib/contact-finder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAnthropicFactory } from "@/agents/client";
import { advancePipelines } from "@/agents/pipeline";
import { requeueStuckExpress, submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { agents, floors, leads, setupItems, tasks } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let fake: ReturnType<typeof fakeAnthropic>;
const NOW = new Date("2026-10-06T06:00:00Z");

beforeAll(async () => {
  // D079: the Analyst reads company websites in code; tests never touch the network
  setPageFetch(async () => ({ ok: false, status: 404, html: "" }));
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  fake = fakeAnthropic((params) => {
    const text = JSON.stringify(params.messages[0]?.content ?? "");
    if (text.includes("Exclusion list")) return { leads: [], note: "none" };
    if (text.includes("Second try")) return { score: 7, reason: "Customs heavy", qualified: true, website: "https://cargoline.example", decisionMaker: { name: "", title: "", email: "info@cargoline.example", linkedin: "", confidence: 0.5 }, research: ["Clears cargo at Jebel Ali"], angle: "shipping bills", notes: "" };
    if (text.includes("Qualify this company")) return { score: 7, reason: "Customs heavy", qualified: true, website: "", decisionMaker: { name: "", title: "", email: "", linkedin: "", confidence: 0 }, research: [], angle: "", notes: "no email" };
    return {};
  });
  setAnthropicFactory(() => fake);
  await setSetting(db, "simulation_mode", false);
  await db.update(floors).set({ status: "paused" }).where(eq(floors.slug, "deals"));
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret("sk-ant-test"), hint: "set" }).where(eq(setupItems.key, "anthropic_api_key"));
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  if (close) await close();
});

describe("Express mode and the Analyst's first look", () => {
  it("runs queued tasks directly while express is on, and a no email lead gets no second look (D079)", async () => {
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    await db.insert(leads).values({ floorId: floor!.id, company: "Cargo Line", dedupeKey: "cargo-line", country: "AE", status: "new", simulated: false });
    await setSetting(db, "express_until", new Date(NOW.getTime() + 3600_000).toISOString());
    await setSetting(db, "pipeline_day_docledger", "2026-10-06");

    await advancePipelines(db, NOW);
    const first = await submitQueuedTasks(db, NOW);
    expect(first.status).toBe("express");
    expect(fake.batches.size).toBe(0); // no batch: answered in the same tick
    let [lead] = await db.select().from(leads).where(eq(leads.company, "Cargo Line")).limit(1);
    expect(lead!.status).toBe("no_contact");

    // D079: no second look. The Tower read the site itself before the first look (nothing to read here), so the
    // company stays no_contact and waits for the owner's call sheet instead of another model call.
    await advancePipelines(db, NOW);
    expect(await db.select().from(tasks).where(and(eq(tasks.kind, "qualify_lead"), sql`${tasks.input} ->> 'retry' = 'true'`))).toHaveLength(0);
    [lead] = await db.select().from(leads).where(eq(leads.company, "Cargo Line")).limit(1);
    expect(lead!.status).toBe("no_contact");
    expect((lead!.decisionMaker as { siteNote?: string | null }).siteNote).toBe("no website to read");
  });

  it("lets one worker run several tasks side by side in express mode", async () => {
    await setSetting(db, "express_until", new Date(NOW.getTime() + 3600_000).toISOString());
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    for (const c of ["Alpha Freight", "Beta Freight", "Gamma Freight"]) await db.insert(leads).values({ floorId: floor!.id, company: c, dedupeKey: c.toLowerCase(), country: "GB", status: "new", simulated: false });
    await advancePipelines(db, NOW);
    const res = await submitQueuedTasks(db, NOW);
    expect(res.submitted).toBe(3);
    const statuses = (await db.select().from(leads)).filter((l) => l.company.endsWith("Freight")).map((l) => l.status);
    expect(statuses).toEqual(["no_contact", "no_contact", "no_contact"]);
  });

  it("puts tasks from a tick that died mid express run back in the queue", async () => {
    const [analyst] = await db.select().from(agents).where(eq(agents.slug, "docledger_analyst")).limit(1);
    const [t] = await db.insert(tasks).values({ floorId: analyst!.floorId, agentId: analyst!.id, kind: "qualify_lead", title: "Stuck", status: "running", batchId: "express", startedAt: new Date(NOW.getTime() - 20 * 60_000), attempts: 1, simulated: false }).returning();
    await db.update(agents).set({ status: "working", currentTaskId: t!.id }).where(eq(agents.id, analyst!.id));
    expect(await requeueStuckExpress(db, NOW)).toBe(1);
    const [after] = await db.select().from(tasks).where(eq(tasks.id, t!.id)).limit(1);
    expect(after!.status).toBe("queued");
    const [a] = await db.select().from(agents).where(eq(agents.id, analyst!.id)).limit(1);
    expect(a!.currentTaskId).toBeNull();
  });

  it("goes back to batches when express ends", async () => {
    await setSetting(db, "express_until", new Date(NOW.getTime() - 60_000).toISOString());
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    await db.insert(leads).values({ floorId: floor!.id, company: "Later Co", dedupeKey: "later-co", country: "GB", status: "new", simulated: false });
    await advancePipelines(db, NOW);
    const res = await submitQueuedTasks(db, NOW);
    expect(res.status).toBe("ok");
    expect(fake.batches.size).toBe(1);
  });
});
