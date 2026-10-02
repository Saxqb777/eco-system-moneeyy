import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advancePipelines, DAILY_SEND_CAP, EMAILS_PER_TICK } from "@/agents/pipeline";
import { founderNumbers } from "@/agents/growth";
import { salesFunnel } from "@/agents/docledger-autonomy";
import type { Db } from "@/db/client";
import { agents, approvals, floors, leads, messagesOut, outreach, setupItems, taskEvents, tasks } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { recordDemoRead, recordDemoVisit } from "@/lib/demo-visits";
import { fetchReceivedEmail, isStopReply, isSuppressed, recordEmailEvent, recordInboundReply, repairBlankReplies, sendOutreach, setEmailTransport, stripQuoted } from "@/lib/email";
import { listThreads, threadDetail } from "@/lib/mailbox";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const T0 = new Date("2026-10-06T06:00:00Z"); // 10:00 Dubai, Tuesday
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const hours = (n: number) => new Date(T0.getTime() + n * 3600_000);

// The fake Resend: records sends, answers "get received email" from a map, and can play a sending only key.
const sent: Array<Record<string, unknown>> = [];
const received = new Map<string, { text?: string; html?: string; from: string; subject: string }>();
let readOnlyKey = false;
let codeSeq = 0;

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

async function addLead(company: string, email: string, status = "contacted", extra: Record<string, unknown> = {}) {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [lead] = await db
    .insert(leads)
    .values({ floorId: floor!.id, company, dedupeKey: company.toLowerCase().replace(/\s+/g, "-"), website: `https://${company.toLowerCase().replace(/\s+/g, "")}.example`, segment: "freight_forwarder", city: "Dubai", country: "AE", score: 8, status, decisionMaker: { name: `${company.split(" ")[0]} Contact`, title: "Finance Manager", email }, previewCode: `c${(++codeSeq).toString(36)}${company.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5)}`, simulated: false, ...extra })
    .returning();
  return lead!;
}

async function sentEmail(leadId: string, at: Date, resendId: string, step = 1) {
  const [row] = await db.insert(outreach).values({ leadId, step, subject: "Your shipping bills", bodyText: "Hi, your month end.", status: "sent", resendId, sentAt: at, simulated: false, createdAt: at, updatedAt: at }).returning();
  return row!;
}

async function approvedEmail(leadId: string, to: string, step = 1) {
  const [row] = await db.insert(outreach).values({ leadId, step, subject: "Your shipping bills", bodyText: "Hi, your month end.", status: "draft", simulated: false, createdAt: T0, updatedAt: T0 }).returning();
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [a] = await db
    .insert(approvals)
    .values({ type: "outreach_email", status: "approved", summary: `Send first outreach email to ${to}`, content: { to, outreachId: row!.id, step }, decidedAt: T0, decidedVia: "ui", floorId: floor!.id, simulated: false, createdAt: T0, updatedAt: T0 })
    .returning();
  await db.update(outreach).set({ approvalId: a!.id }).where(eq(outreach.id, row!.id));
  return { row: row!, approval: a! };
}

const telegram = fakeTelegram();

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(telegram.api);
  await setSetting(db, "simulation_mode", false);
  await paste("resend_api_key", "re_test");
  await paste("resend_from", "Saaqib Khan <saaqib@docledger.example>");
  await db.update(floors).set({ status: "paused" }).where(eq(floors.slug, "growth"));
  await db.update(floors).set({ status: "paused" }).where(eq(floors.slug, "trading"));
  setEmailTransport(async (_key, path, method, body) => {
    if (method === "GET" && path.startsWith("/emails/receiving/")) {
      if (readOnlyKey) return { ok: false, status: 401, json: { message: "This API key is restricted to only send emails" } };
      const got = received.get(path.slice("/emails/receiving/".length));
      return got ? { ok: true, status: 200, json: { ...got, id: path.slice(19) } } : { ok: false, status: 404, json: { message: "not found" } };
    }
    sent.push(body ?? {});
    return { ok: true, status: 200, json: { id: `re_${sent.length}` } };
  });
}, 60_000);

afterAll(async () => {
  setEmailTransport(null);
  if (close) await close();
});

describe("reply text (D077)", () => {
  it("cuts the quoted history off a reply and spots a stop", () => {
    expect(stripQuoted("Sounds good, send times.\n\nOn Tue, 6 Oct 2026, Saaqib Khan <s@x.com> wrote:\n> Hi Farah\n> your month end")).toBe("Sounds good, send times.");
    expect(stripQuoted("Yes please.\r\n\r\n-----Original Message-----\r\nFrom: Saaqib")).toBe("Yes please.");
    expect(stripQuoted("Thanks\n\nFrom: Saaqib Khan\nSent: Monday\nTo: me")).toBe("Thanks");
    expect(stripQuoted("> only quoted\n> lines")).toBe("> only quoted\n> lines");
    expect(isStopReply("Please stop emailing us.\n\nOn Tue wrote:\n> hi")).toBe(true);
    expect(isStopReply("Unsubscribe")).toBe(true);
    expect(isStopReply("Not interested, thanks.")).toBe(true);
    expect(isStopReply("Stopping by your office next week would be great")).toBe(false);
    expect(isStopReply("Can you send a price list?")).toBe(false);
  });

  it("reads a reply by id when the webhook has no body", async () => {
    received.set("em-1", { text: "Interesting, who do I speak to?\n\nOn Tue wrote:\n> Hi", from: "Atif <hello@qafila.example>", subject: "Re: bills" });
    const got = await fetchReceivedEmail(db, "em-1");
    expect(got.ok && got.text).toBe("Interesting, who do I speak to?\n\nOn Tue wrote:\n> Hi");
    const html = received.set("em-2", { html: "<p>Yes&nbsp;please<br>send times</p>", from: "a@b.example", subject: "" }).get("em-2");
    expect(html).toBeTruthy();
    const got2 = await fetchReceivedEmail(db, "em-2");
    expect(got2.ok && got2.text).toBe("Yes please\nsend times");
    readOnlyKey = true;
    const refused = await fetchReceivedEmail(db, "em-1");
    expect(!refused.ok && refused.permission).toBe(true);
    readOnlyKey = false;
  });

  it("parks a bodyless reply, keeps the Chaser away, then repairs it and the Chaser gets a fresh task", async () => {
    const lead = await addLead("Qafila Freight", "hello@qafila.example");
    await sentEmail(lead.id, hours(-2), "re_q1");
    // The webhook arrives while the key is sending only: the row waits.
    readOnlyKey = true;
    const r = await recordInboundReply(db, { from: "Atif <hello@qafila.example>", subject: "Re: Your shipping bills", text: "", emailId: "em-q", pending: true }, T0);
    expect(r).toMatchObject({ matched: true, pending: true });
    let [row] = await db.select().from(outreach).where(eq(outreach.leadId, lead.id));
    expect(row!.status).toBe("reply_pending");
    expect(row!.replyEmailId).toBe("em-q");
    // The pipeline runs the repair step first; the refusal is told to the owner once a day, and no Chaser task is made.
    const a1 = await advancePipelines(db, min(1));
    expect(a1.created.follow_up ?? 0).toBe(0);
    const rep = await repairBlankReplies(db, min(2));
    expect(rep.permission).toBe(true);
    const hints = await db.select().from(messagesOut).where(eq(messagesOut.kind, "setup"));
    expect(hints).toHaveLength(1);
    expect(hints[0]!.body).toContain("Full access");
    await repairBlankReplies(db, min(3));
    expect(await db.select().from(messagesOut).where(eq(messagesOut.kind, "setup"))).toHaveLength(1);
    // The Mailbox shows the thread as replied, with the placeholder.
    const detail = await threadDetail(db, lead.id, min(3));
    expect(detail!.items.at(-1)!.body).toContain("no text in the webhook");
    // He pastes a Full access key: the next heartbeat reads the text, the Chaser gets its task.
    readOnlyKey = false;
    received.set("em-q", { text: "Interesting. Who is this for exactly?\n\nOn Tue, Saaqib wrote:\n> Hi Atif", from: "Atif <hello@qafila.example>", subject: "Re: Your shipping bills" });
    const a2 = await advancePipelines(db, min(5));
    expect(a2.created.replies_read).toBe(1);
    expect(a2.created.follow_up).toBe(1);
    [row] = await db.select().from(outreach).where(eq(outreach.leadId, lead.id));
    expect(row!.status).toBe("handling");
    expect(row!.replyText).toBe("Interesting. Who is this for exactly?");
    const told = await db.select().from(messagesOut).where(and(eq(messagesOut.kind, "reply"), sql`${messagesOut.body} like '%Who is this for%'`));
    expect(told).toHaveLength(1);
  });

  it("repairs the old placeholder rows too and replaces a blocked Chaser task", async () => {
    const lead = await addLead("Old Placeholder Co", "info@oldplaceholder.example");
    const row = await sentEmail(lead.id, hours(-3), "re_old");
    await db.update(outreach).set({ status: "handling", replyText: "(no text in the webhook, email id em-old-1234567890)", replyAt: hours(-1) }).where(eq(outreach.id, row.id));
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    const [chaser] = await db.select().from(agents).where(eq(agents.slug, "docledger_chaser")).limit(1);
    const [blocked] = await db.insert(tasks).values({ floorId: floor!.id, agentId: chaser!.id, kind: "follow_up", title: "Chase warm reply", status: "blocked", blockedReason: "waiting for the text", input: { outreachId: row.id, mode: "reply" }, simulated: false }).returning();
    received.set("em-old-1234567890", { text: "Please remove me from your list.", from: "info@oldplaceholder.example", subject: "Re: Your shipping bills" });
    const rep = await repairBlankReplies(db, min(10));
    expect(rep.repaired).toBe(1);
    const [after] = await db.select().from(tasks).where(eq(tasks.id, blocked!.id));
    expect(after!.status).toBe("done");
    const [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("lost");
    expect(await isSuppressed(db, "info@oldplaceholder.example")).toBe(true);
    const [o] = await db.select().from(outreach).where(eq(outreach.id, row.id));
    expect(o!.status).toBe("answered");
    expect(o!.replyText).toBe("Please remove me from your list.");
  });

  it("closes a stop reply by code and never emails that address again", async () => {
    const lead = await addLead("Stop Shipping", "accounts@stopshipping.example");
    await sentEmail(lead.id, hours(-5), "re_stop");
    const r = await recordInboundReply(db, { from: "accounts@stopshipping.example", subject: "Re: Your shipping bills", text: "STOP. Not interested.\n\nOn Mon wrote:\n> Hi" }, T0);
    expect(r.stopped).toBe(true);
    const [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("lost");
    const a = await advancePipelines(db, min(1));
    expect(a.created.follow_up ?? 0).toBe(0);
    // A later approved email to that address is dropped, and the approval still counts as executed.
    const { approval } = await approvedEmail(lead.id, "accounts@stopshipping.example", 2);
    const before = sent.length;
    const res = await sendOutreach(db, approval, T0);
    expect(res.ok).toBe(true);
    expect(res.skipped).toContain("stop list");
    expect(sent.length).toBe(before);
  });
});

describe("delivery events (D077)", () => {
  it("marks delivered, bounced and complained emails and stops the follow ups", async () => {
    const good = await addLead("Delivered Cargo", "ops@delivered.example");
    const goodRow = await sentEmail(good.id, hours(-4), "re_good");
    expect(await recordEmailEvent(db, { type: "email.delivered", emailId: "re_good", to: "ops@delivered.example" }, T0)).toMatchObject({ matched: true, outcome: "delivered" });
    const [g] = await db.select().from(outreach).where(eq(outreach.id, goodRow.id));
    expect(g!.deliveredAt).not.toBeNull();

    const bad = await addLead("Bounced Freight", "finance@bounced.example");
    const badRow = await sentEmail(bad.id, hours(-4 * 24), "re_bad");
    expect(await recordEmailEvent(db, { type: "email.bounced", emailId: "re_bad", to: "finance@bounced.example", bounce: { message: "The recipient address does not exist", type: "Permanent", subType: "General" } }, T0)).toMatchObject({ outcome: "bounced" });
    const [b] = await db.select().from(outreach).where(eq(outreach.id, badRow.id));
    expect(b!.status).toBe("bounced");
    expect(b!.bounceReason).toContain("does not exist");
    const [bl] = await db.select().from(leads).where(eq(leads.id, bad.id));
    expect(bl!.status).toBe("bounced");
    expect(await isSuppressed(db, "finance@bounced.example")).toBe(true);
    // Four days old and never answered, but bounced: no follow up is written for it.
    const a = await advancePipelines(db, T0);
    const followUps = await db.select().from(tasks).where(and(eq(tasks.kind, "follow_up"), sql`${tasks.input} ->> 'outreachId' = ${badRow.id}`));
    expect(followUps).toHaveLength(0);
    expect(a.status).toBeDefined();

    const angry = await addLead("Angry Logistics", "md@angry.example");
    await sentEmail(angry.id, hours(-6), "re_angry");
    expect(await recordEmailEvent(db, { type: "email.complained", emailId: "re_angry", to: "md@angry.example" }, T0)).toMatchObject({ outcome: "complained" });
    const [al] = await db.select().from(leads).where(eq(leads.id, angry.id));
    expect(al!.status).toBe("lost");
    expect(await isSuppressed(db, "md@angry.example")).toBe(true);
    const told = await db.select().from(messagesOut).where(sql`${messagesOut.body} like '%marked our email as spam%'`);
    expect(told).toHaveLength(1);

    expect(await recordEmailEvent(db, { type: "email.delivered", emailId: "re_unknown", to: "x@y.example" }, T0)).toEqual({ matched: false });
    const funnel = await salesFunnel(db, T0);
    expect(funnel.deliveredWeek).toBeGreaterThanOrEqual(1);
    expect(funnel.bouncedWeek).toBeGreaterThanOrEqual(1);
    const numbers = await founderNumbers(db, T0);
    expect(numbers.delivered).toBeGreaterThanOrEqual(1);
    expect(numbers.bounced).toBeGreaterThanOrEqual(1);
  });
});

describe("one first email per company, a few per heartbeat (D077)", () => {
  it("drops a second approved first email for a company that already got one", async () => {
    const lead = await addLead("Twice Trading", "info@twice.example", "contacted");
    await sentEmail(lead.id, hours(-30), "re_first");
    const { row, approval } = await approvedEmail(lead.id, "info@twice.example", 1);
    const before = sent.length;
    const res = await sendOutreach(db, approval, T0);
    expect(res).toMatchObject({ ok: true });
    expect(res.skipped).toContain("already had its first email");
    expect(sent.length).toBe(before);
    const [after] = await db.select().from(outreach).where(eq(outreach.id, row.id));
    expect(after!.status).toBe("duplicate");
    // A follow up (step 2) for the same company is not a duplicate.
    const second = await approvedEmail(lead.id, "info@twice.example", 2);
    const res2 = await sendOutreach(db, second.approval, T0);
    expect(res2).toEqual({ ok: true });
    expect(sent.length).toBe(before + 1);
  });

  it("sends at most two worker emails per heartbeat and stops at the daily cap", async () => {
    // Earlier tests sent directly; their approvals are not for this heartbeat.
    await db.update(approvals).set({ executedAt: T0 }).where(sql`${approvals.executedAt} is null`);
    const before = sent.length;
    const items: Array<{ approval: typeof approvals.$inferSelect }> = [];
    for (let i = 0; i < 4; i++) {
      const lead = await addLead(`Paced Forwarder ${i}`, `ops@paced${i}.example`, "drafted");
      items.push(await approvedEmail(lead.id, `ops@paced${i}.example`, 1));
    }
    const a1 = await advancePipelines(db, min(20));
    expect(a1.executed).toBe(EMAILS_PER_TICK);
    expect(sent.length).toBe(before + EMAILS_PER_TICK);
    expect(a1.deferred.some((d) => d.includes("spread over the day"))).toBe(true);
    const a2 = await advancePipelines(db, min(35));
    expect(sent.length).toBe(before + 4);
    expect(a2.executed).toBe(2);
    // The owner's own words are never held, and the daily cap holds the workers.
    await setSetting(db, "docledger_daily_send_cap", 1);
    const held = await addLead("Capped Cargo", "ops@capped.example", "drafted");
    await approvedEmail(held.id, "ops@capped.example", 1);
    const mine = await addLead("Owner Writes", "ceo@ownerwrites.example", "contacted");
    const own = await approvedEmail(mine.id, "ceo@ownerwrites.example", 2);
    await db.update(approvals).set({ content: { ...(own.approval.content as Record<string, unknown>), ownerSent: true } }).where(eq(approvals.id, own.approval.id));
    const a3 = await advancePipelines(db, min(50));
    expect(a3.deferred.some((d) => d.includes("daily send cap"))).toBe(true);
    expect(sent.at(-1)).toMatchObject({ to: ["ceo@ownerwrites.example"] });
    await setSetting(db, "docledger_daily_send_cap", DAILY_SEND_CAP);
  });
});

describe("demo visits (D077)", () => {
  it("tells a link checker from a person, pings once, shows the visit in the Mailbox and nudges a day later", async () => {
    const lead = await addLead("Visiting Logistics", "finance@visiting.example", "contacted");
    await sentEmail(lead.id, T0, "re_visit");
    // 40 seconds after the send: a scanner.
    expect((await recordDemoVisit(db, lead.previewCode!, new Date(T0.getTime() + 40_000))).kind).toBe("scan");
    // Hours later with a bot agent: a scanner.
    expect((await recordDemoVisit(db, lead.previewCode!, hours(2), { agent: "Mozilla/5.0 (compatible; SafeLinks Scanner)" })).kind).toBe("scan");
    // Hours later from a browser: a visit, with one Telegram ping.
    const v = await recordDemoVisit(db, lead.previewCode!, hours(3), { agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1" });
    expect(v).toMatchObject({ kind: "visit", visits: 1 });
    expect((await recordDemoVisit(db, lead.previewCode!, new Date(hours(3).getTime() + 10_000))).kind).toBe("scan"); // a burst
    expect((await recordDemoVisit(db, lead.previewCode!, hours(4))).kind).toBe("visit");
    const pings = await db.select().from(messagesOut).where(eq(messagesOut.kind, "demo_visit"));
    expect(pings).toHaveLength(1);
    const [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.demoScans).toBe(3);
    expect(l!.demoVisits).toBe(2);
    expect((await recordDemoVisit(db, "nocode99", hours(4))).kind).toBe("none");
    const events = await db.select().from(taskEvents).where(eq(taskEvents.type, "demo_visit"));
    expect(events.length).toBeGreaterThanOrEqual(2);

    const threads = await listThreads(db, false, "all", hours(5));
    const mine = threads.find((t) => t.leadId === lead.id)!;
    expect(mine.state).toBe("visited");
    expect(mine.lastLine).toContain("Opened the demo company");
    const detail = await threadDetail(db, lead.id, hours(5));
    expect(detail!.items.at(-1)).toMatchObject({ from: "them", status: "visit" });

    // Too soon for a nudge, then a day later one nudge task, and only one.
    const soon = await advancePipelines(db, hours(6));
    const nudgesSoon = await db.select().from(tasks).where(and(eq(tasks.kind, "follow_up"), sql`${tasks.input} ->> 'mode' = 'nudge'`));
    expect(nudgesSoon).toHaveLength(0);
    expect(soon.status).toBeDefined();
    await advancePipelines(db, hours(4 + 21));
    await advancePipelines(db, hours(4 + 22));
    const nudges = await db.select().from(tasks).where(and(eq(tasks.kind, "follow_up"), sql`${tasks.input} ->> 'mode' = 'nudge'`));
    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.title).toContain("Nudge Visiting Logistics");

    // A document of theirs read in the demo: the strongest signal, always a ping.
    const read = await recordDemoRead(db, lead.previewCode!, hours(30));
    expect(read.kind).toBe("visit");
    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(after!.demoReads).toBe(1);
    const detail2 = await threadDetail(db, lead.id, hours(31));
    expect(detail2!.items.at(-1)).toMatchObject({ status: "read" });
    const funnel = await salesFunnel(db, hours(31));
    expect(funnel.demoVisitsWeek).toBeGreaterThanOrEqual(1);
    expect(funnel.visitedOpen).toBeGreaterThanOrEqual(1);
  });
});
