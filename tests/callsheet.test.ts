import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBatches } from "@/agents/batches";
import { setAnthropicFactory } from "@/agents/client";
import { advancePipelines } from "@/agents/pipeline";
import { advanceDirectory, directoryOfTheDay, isHomeDay } from "@/agents/playbooks";
import { handleTaskBatchResult, submitQueuedTasks } from "@/agents/workers";
import { DIRECTORIES } from "@/config/docledger";
import type { Db } from "@/db/client";
import { approvals, floors, leads, messagesOut, outreach, setupItems, tasks } from "@/db/schema";
import { callSheet, callSheetCard, findOnSheet, maybeSendCallSheet, recordCall } from "@/lib/callsheet";
import { setPageFetch } from "@/lib/contact-finder";
import { encryptSecret } from "@/lib/crypto";
import { setEmailTransport } from "@/lib/email";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const DAY = 24 * 3600_000;
const T0 = new Date("2026-10-06T05:00:00Z"); // 09:00 Dubai, Tuesday: a home market day
const at = (ms: number) => new Date(T0.getTime() + ms);
let fake: ReturnType<typeof fakeAnthropic>;
let codeSeq = 0;

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

async function addLead(company: string, o: { phone?: string | null; status?: string; country?: string; email?: string; name?: string; visitedAt?: Date | null; score?: number; calls?: Array<{ at: string; outcome: string }>; segment?: string; website?: string } = {}) {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [lead] = await db
    .insert(leads)
    .values({
      floorId: floor!.id,
      company,
      dedupeKey: company.toLowerCase().replace(/\s+/g, "-"),
      website: o.website ?? `https://${company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`,
      segment: o.segment ?? "freight_forwarder",
      city: "Dubai",
      country: o.country ?? "AE",
      phone: o.phone === undefined ? "+97145550000" : o.phone,
      score: o.score ?? 8,
      scoreReason: "Customs heavy forwarder",
      status: o.status ?? "contacted",
      demoVisitedAt: o.visitedAt ?? null,
      demoVisits: o.visitedAt ? 1 : 0,
      decisionMaker: { name: o.name ?? "", title: o.name ? "Finance Manager" : "", email: o.email ?? "", research: ["Runs sea freight out of Jebel Ali"], angle: "shipping bills", ...(o.calls ? { calls: o.calls } : {}) },
      previewCode: `c${(++codeSeq).toString(36)}${company.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)}`,
      preview: { sampleDocument: "Shipping line bill, Maersk, Jebel Ali", sampleFields: [] },
      simulated: false,
    })
    .returning();
  return lead!;
}

async function sentRow(leadId: string, step: number, sentAt: Date) {
  const [row] = await db.insert(outreach).values({ leadId, step, subject: `Step ${step}`, bodyText: "Hi, your month end.", status: "sent", resendId: `re_${leadId.slice(0, 6)}_${step}`, sentAt, simulated: false, createdAt: sentAt, updatedAt: sentAt }).returning();
  return row!;
}

async function runBatch(now: Date) {
  await submitQueuedTasks(db, now);
  await collectBatches(db, now, async (r) => handleTaskBatchResult(db, r, now));
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  setPageFetch(async () => ({ ok: false, status: 404, html: "" }));
  setEmailTransport(async () => ({ ok: true, status: 200, json: { id: "re_x" } }));
  await setSetting(db, "simulation_mode", false);
  await paste("anthropic_api_key", "sk-ant-test");
  await db.update(floors).set({ status: "paused" }).where(eq(floors.slug, "growth"));
  await db.update(floors).set({ status: "paused" }).where(eq(floors.slug, "trading"));
  // the Scout's morning task is not what these tests are about
  await setSetting(db, "pipeline_day_docledger", "2026-10-06");
  fake = fakeAnthropic((params) => {
    const text = JSON.stringify(params.messages[0]?.content ?? "");
    if (text.includes("after the call")) return { action: "propose_times", intent: "interested", summary: "Interested after the call, wants a walkthrough", subject: "Doc Ledger, after our call", body: "Thank you for the time today. The demo company is ready for you. Pick a slot whenever suits.", demoBooked: false, note: "" };
    if (text.includes("Write the email")) return { subject: "Your shipping bills", body: "Hello,\n\nYour month end.\n{preview}\nReply and the first month is free.\nSaaqib\nReply stop and I will not write again.", personalisation: "Jebel Ali", preview: { headline: "Forty shipping bills, none retyped", intro: "your month end.", points: ["Photograph the bill.", "Charge lines add up.", "Your own types."], sampleDocument: "Shipping line bill", sampleFields: [{ field: "BL number", value: "MAEU123 (example)" }] } };
    if (text.includes("Thread:")) return { action: "follow_up", intent: "no_reply", summary: "Follow up", subject: "Re: Step 1", body: "A short follow up.", demoBooked: false, note: "" };
    return {};
  });
  setAnthropicFactory(() => fake);
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setEmailTransport(null);
  setPageFetch(null);
  if (close) await close();
});

describe("The owner's call sheet (D079)", () => {
  it("picks five home market companies with a phone, demo visitors first, and remembers the day's pick", async () => {
    const a = await addLead("Qafila FZ LLC", { visitedAt: at(-5 * 3600_000), name: "Atif Rafiq", email: "hello@qafila.example" });
    const b = await addLead("Sea Prince Shipping", { status: "no_contact", score: 9 });
    await addLead("No Phone Cargo", { phone: null });
    await addLead("London Freight", { country: "GB" });
    await addLead("Said No Logistics", { calls: [{ at: at(-3 * DAY).toISOString(), outcome: "no" }] });
    await addLead("Lost Cause Cargo", { status: "lost" });
    await addLead("Fenex Association", { segment: "partner_association" });
    const sheet = await callSheet(db, T0);
    expect(sheet.rows.map((r) => r.company)).toEqual(["Qafila FZ LLC", "Sea Prince Shipping"]);
    expect(sheet.rows[0]).toMatchObject({ leadId: a.id, contact: "Atif Rafiq", why: "opened their demo and stayed quiet", bill: "Shipping line bill, Maersk, Jebel Ali", emailed: false, visited: true });
    expect(sheet.rows[0]!.opening).toContain("Hi Atif");
    expect(sheet.rows[0]!.demoUrl).toContain(a.previewCode);
    expect(sheet.rows[1]).toMatchObject({ leadId: b.id, contact: null, why: "good fit, no public email" });
    expect(sheet.rows[1]!.opening).toContain("whoever handles the shipping bills");
    // a new company later in the day does not shuffle the sheet
    await addLead("Late Arrival Logistics", { score: 10 });
    expect((await callSheet(db, at(3600_000))).rows.map((r) => r.company)).toEqual(["Qafila FZ LLC", "Sea Prince Shipping"]);
    const card = await callSheetCard(db, T0);
    expect(card).toContain("Call sheet for today: 2 companies");
    expect(card!.indexOf("Qafila")).toBeLessThan(card!.indexOf("Sea Prince"));
    expect(card).toContain("/called <company>");
    expect((await findOnSheet(db, "qafila", T0))?.leadId).toBe(a.id);
    expect(await findOnSheet(db, "nobody", T0)).toBeNull();
  });

  it("sends the card once a day after 10:00 Dubai", async () => {
    expect(await maybeSendCallSheet(db, T0)).toBe(false); // 09:00
    expect(await maybeSendCallSheet(db, at(65 * 60_000))).toBe(true); // 10:05
    expect(await maybeSendCallSheet(db, at(120 * 60_000))).toBe(false);
    const cards = await db.select().from(messagesOut).where(eq(messagesOut.kind, "call_sheet"));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.body).toContain("+97145550000");
  });

  it("records calls: no answer keeps them, interested makes the Chaser write the email after the call", async () => {
    const [a] = await db.select().from(leads).where(eq(leads.company, "Qafila FZ LLC"));
    const [b] = await db.select().from(leads).where(eq(leads.company, "Sea Prince Shipping"));
    const r1 = await recordCall(db, a!.id, "no_answer", null, at(70 * 60_000));
    expect(r1.message).toContain("no answer");
    const [a2] = await db.select().from(leads).where(eq(leads.id, a!.id));
    expect(a2!.status).toBe("contacted");
    expect(((a2!.decisionMaker as { calls: unknown[] }).calls ?? []).length).toBe(1);

    const r2 = await recordCall(db, b!.id, "interested", "wants the customs invoice read first", at(75 * 60_000));
    expect(r2.ok).toBe(true);
    const [b2] = await db.select().from(leads).where(eq(leads.id, b!.id));
    expect(b2!.status).toBe("replied");
    expect((b2!.decisionMaker as { hotFromCall?: string }).hotFromCall).toBeTruthy();

    // the pipeline queues the email after the call, even though Sea Prince never got an email
    const adv = await advancePipelines(db, at(80 * 60_000));
    expect(adv.created.follow_up).toBeGreaterThanOrEqual(1);
    const [task] = await db.select().from(tasks).where(and(eq(tasks.kind, "follow_up"), sql`${tasks.input} ->> 'mode' = 'after_call'`));
    expect(task!.title).toBe("Email Sea Prince Shipping after the call");
    await runBatch(at(85 * 60_000));
    const [approval] = await db.select().from(approvals).where(sql`${approvals.summary} like 'After the call: email%'`);
    expect(approval).toBeTruthy();
    expect(approval!.status).toBe("pending"); // hot: his to approve
    const rows = await db.select().from(outreach).where(eq(outreach.leadId, b!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.step).toBe(1);
    const [b3] = await db.select().from(leads).where(eq(leads.id, b!.id));
    expect((b3!.decisionMaker as { hotFromCall?: string | null }).hotFromCall ?? null).toBeNull();
    // no second task for the same call
    const again = await advancePipelines(db, at(90 * 60_000));
    const afterCalls = await db.select().from(tasks).where(and(eq(tasks.kind, "follow_up"), sql`${tasks.input} ->> 'mode' = 'after_call'`));
    expect(afterCalls).toHaveLength(1);
    expect(again.status).toBeDefined();

    const x = await addLead("Not Now Movers");
    await recordCall(db, x.id, "not_now", null, T0);
    const [x2] = await db.select().from(leads).where(eq(leads.id, x.id));
    expect((x2!.decisionMaker as { snoozeUntil?: string }).snoozeUntil).toBeTruthy();
    const y = await addLead("Hard No Freight");
    await recordCall(db, y.id, "no", "they use SAP", T0);
    const [y2] = await db.select().from(leads).where(eq(leads.id, y.id));
    expect(y2!.status).toBe("lost");
    expect((await recordCall(db, "00000000-0000-0000-0000-000000000000", "no", null, T0)).ok).toBe(false);
  });
});

describe("The follow up ladder (D079)", () => {
  it("climbs on time, one angle per step, and stops after the last email", async () => {
    const l = await addLead("Ladder One", { email: "ops@ladderone.example" });
    await sentRow(l.id, 1, at(-3.5 * DAY));
    const m = await addLead("Ladder Two", { email: "ops@laddertwo.example" });
    await sentRow(m.id, 2, at(-3.5 * DAY));
    const n = await addLead("Ladder Three", { email: "ops@ladderthree.example" });
    await sentRow(n.id, 2, at(-4.5 * DAY));
    const p = await addLead("Ladder Four", { email: "ops@ladderfour.example" });
    await sentRow(p.id, 4, at(-8 * DAY));
    const q = await addLead("Ladder Five", { email: "ops@ladderfive.example" });
    await sentRow(q.id, 5, at(-30 * DAY));
    await advancePipelines(db, T0);
    const titles = (await db.select({ title: tasks.title, input: tasks.input }).from(tasks).where(and(eq(tasks.kind, "follow_up"), sql`${tasks.input} ->> 'mode' = 'follow_up'`))).map((t) => t.title).sort();
    expect(titles).toEqual(["Last email to Ladder Four", "Send follow up 2", "Send follow up 3"]);
  });
});

describe("The Scout's home market and directories (D079)", () => {
  it("works the Gulf five days in seven and moves through the directory pages", async () => {
    expect(isHomeDay(new Date("2026-10-06T05:00:00Z"))).toBe(true); // Tuesday
    expect(isHomeDay(new Date("2026-10-04T05:00:00Z"))).toBe(false); // Sunday
    expect(isHomeDay(new Date("2026-10-07T05:00:00Z"))).toBe(false); // Wednesday
    expect(await directoryOfTheDay(db)).toEqual({ name: DIRECTORIES[0]!.name, url: DIRECTORIES[0]!.url, page: 1 });
    await advanceDirectory(db, true);
    expect((await directoryOfTheDay(db))?.page).toBe(2);
    await advanceDirectory(db, false);
    expect(await directoryOfTheDay(db)).toEqual({ name: DIRECTORIES[1]!.name, url: DIRECTORIES[1]!.url, page: 1 });
  });
});

describe("The Writer's two lanes (D079)", () => {
  it("writes to the front desk for a shared inbox and to the person when there is one", async () => {
    await addLead("Shared Inbox Cargo", { status: "qualified", email: "info@sharedinbox.example" });
    await addLead("Named Person Freight", { status: "qualified", email: "farah@namedperson.example", name: "Farah Haddad" });
    await advancePipelines(db, at(2 * 3600_000));
    await runBatch(at(2 * 3600_000 + 60_000));
    await runBatch(at(2 * 3600_000 + 120_000));
    // direct calls and batch requests both carry the Writer's brief
    const requests = [...fake.calls, ...[...fake.batches.values()].flat().map((r) => r.params)];
    const texts = requests.map((c) => JSON.stringify(c.messages[0]?.content ?? "")).filter((t) => t.includes("Write the email"));
    expect(texts.some((t) => t.includes("Lane: front desk (shared inbox info@sharedinbox.example)") && t.includes("passed to whoever handles"))).toBe(true);
    expect(texts.some((t) => t.includes("Lane: named person (Farah Haddad, farah@namedperson.example)"))).toBe(true);
    const summaries = (await db.select({ s: approvals.summary }).from(approvals).where(sql`${approvals.summary} like 'Send first outreach email%'`)).map((r) => r.s);
    expect(summaries).toContain("Send first outreach email to the front desk (info@sharedinbox.example) at Shared Inbox Cargo");
    expect(summaries).toContain("Send first outreach email to Farah Haddad at Named Person Freight");
  });
});
