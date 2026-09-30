import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAnthropicFactory } from "@/agents/client";
import { trustEarned } from "@/agents/docledger-autonomy";
import { DEALS_AUTO_DECISION, maybeRaiseDealsAutoApprove } from "@/agents/deals";
import { submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { agents, approvals, deals, floors, leads, messagesOut, outreach, setupItems, tasks, ticks } from "@/db/schema";
import { applyApprovalDecision, approvalDetail, raiseApproval } from "@/lib/approvals";
import { encryptSecret } from "@/lib/crypto";
import { setEmailTransport } from "@/lib/email";
import { ownerSend, replySubject, senderName } from "@/lib/owner-send";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { processTelegramUpdate } from "@/lib/telegram-inbound";
import { plainDashes } from "@/lib/text";
import { alertWardenFailed } from "@/warden/decide";
import { acquireTickLock, heartbeatDue, heartbeatSource, lastScheduledTickAt, releaseTickLock, withTickLock } from "@/warden/heartbeat";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let fake: ReturnType<typeof fakeAnthropic>;
const mail: Array<Record<string, unknown>> = [];
const NOW = new Date("2026-10-06T06:00:00Z"); // 10:00 Dubai
const OWNER = "4242";

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  setEmailTransport(async (_key, _path, _method, body) => {
    mail.push(body ?? {});
    return { ok: true, status: 200, json: { id: `re_${mail.length}` } };
  });
  fake = fakeAnthropic((params) => {
    const text = JSON.stringify(params.messages[0]?.content ?? "");
    if (text.includes("Write the post")) return { title: "Anker charger — 38 percent off", body: "Anker 65W charger — AED 89, was AED 145\n- charges a laptop and a phone" };
    if (text.includes("Qualify this company")) return { score: 7, reason: "Customs heavy", qualified: true, website: "", decisionMaker: { name: "", title: "", email: "", linkedin: "", confidence: 0 }, research: [], angle: "", notes: "" };
    return {};
  });
  setAnthropicFactory(() => fake);
  await setSetting(db, "simulation_mode", false);
  await paste("anthropic_api_key", "sk-ant-test");
  await paste("telegram_bot_token", "123:abc");
  await paste("telegram_chat_id", OWNER);
  await paste("resend_api_key", "re_test");
  await paste("resend_from", "Saaqib Khan <saaqib@docledger.site>");
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setEmailTransport(null);
  if (close) await close();
});

describe("The heartbeat never double runs", () => {
  it("holds one lock at a time, and a dead holder's lock expires", async () => {
    expect(await acquireTickLock(db, "a", NOW)).toBe(true);
    expect(await acquireTickLock(db, "b", NOW)).toBe(false);
    expect(await acquireTickLock(db, "b", new Date(NOW.getTime() + 7 * 60_000))).toBe(true);
    await releaseTickLock(db, "a"); // not the holder any more: no effect
    expect(await acquireTickLock(db, "c", new Date(NOW.getTime() + 8 * 60_000))).toBe(false);
    await releaseTickLock(db, "b");
    expect(await acquireTickLock(db, "c", new Date(NOW.getTime() + 8 * 60_000))).toBe(true);
    await releaseTickLock(db, "c");
  });

  it("runs work beside the lock only when it is free", async () => {
    expect((await withTickLock(db, async () => 7)).ran).toBe(true);
    await acquireTickLock(db, "busy", new Date());
    expect((await withTickLock(db, async () => 7, 0)).ran).toBe(false);
    await releaseTickLock(db, "busy");
  });

  it("skips a scheduled knock when the last scheduled tick is fresh", async () => {
    expect(heartbeatDue(null, NOW)).toBe(true);
    await db.insert(ticks).values({ trigger: "manual", status: "done", startedAt: NOW });
    expect(await lastScheduledTickAt(db)).toBeNull();
    await db.insert(ticks).values({ trigger: "cron", status: "done", startedAt: NOW });
    const last = await lastScheduledTickAt(db);
    expect(last?.toISOString()).toBe(NOW.toISOString());
    expect(heartbeatDue(last, new Date(NOW.getTime() + 5 * 60_000))).toBe(false);
    expect(heartbeatDue(last, new Date(NOW.getTime() + 11 * 60_000))).toBe(true);
    expect(heartbeatSource("neon")).toBe("neon");
    expect(heartbeatSource("<script>")).toBe("other");
  });
});

describe("Writing tasks never wait for a batch", () => {
  it("runs a post draft straight away and keeps research on a batch", async () => {
    const [dealsFloor] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    const [docFloor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    await db.update(floors).set({ status: "live", autoApprove: false }).where(sql`${floors.slug} in ('deals', 'docledger')`);
    const [editor] = await db.select().from(agents).where(eq(agents.slug, "deals_editor")).limit(1);
    const [analyst] = await db.select().from(agents).where(eq(agents.slug, "docledger_analyst")).limit(1);
    const [deal] = await db.insert(deals).values({ floorId: dealsFloor!.id, store: "amazon_ae", title: "Anker 65W charger", url: "https://www.amazon.ae/dp/B0ANKER65W", affiliateUrl: "https://www.amazon.ae/dp/B0ANKER65W?tag=t-21", price: "89.00", wasPrice: "145.00", discountPct: "38", status: "found", dedupeKey: "amazon_ae|/dp/b0anker65w", simulated: false }).returning();
    const [lead] = await db.insert(leads).values({ floorId: docFloor!.id, company: "Cargo Line", dedupeKey: "cargo-line-direct", country: "AE", status: "new", simulated: false }).returning();
    await db.insert(tasks).values([
      { floorId: dealsFloor!.id, agentId: editor!.id, kind: "write_post", title: "Write deal post", status: "queued", priority: 5, input: { dealId: deal!.id }, simulated: false },
      { floorId: docFloor!.id, agentId: analyst!.id, kind: "qualify_lead", title: "Qualify Cargo Line", status: "queued", priority: 5, input: { leadId: lead!.id }, simulated: false },
    ]);
    const batchesBefore = fake.batches.size;
    const res = await submitQueuedTasks(db, NOW);
    expect(res.submitted).toBe(2);
    expect(res.direct).toBe(1);
    expect(fake.batches.size).toBe(batchesBefore + 1);
    const batched = [...fake.batches.values()].at(-1)!;
    expect(batched.map((r) => r.custom_id)).toHaveLength(1);
    const [post] = await db.select().from(tasks).where(eq(tasks.kind, "write_post")).limit(1);
    expect(post!.status).toBe("review");
    expect(post!.batchId).toBe("direct");
    const [research] = await db.select().from(tasks).where(eq(tasks.kind, "qualify_lead")).limit(1);
    expect(research!.status).toBe("running");
    // the dash cleaner ran on the draft
    const [ap] = await db.select().from(approvals).where(eq(approvals.type, "public_post")).limit(1);
    expect(String((ap!.content as { body: string }).body)).not.toMatch(/[—–]/);
    expect(ap!.summary).toBe("Post to the deals channel: Anker charger, 38 percent off");
  });
});

describe("The owner sees what he approves", () => {
  it("puts the email, the post or the decision text on the approval message", async () => {
    const email = approvalDetail("outreach_email", { to: "farah@gulf.example", toName: "Farah", company: "Gulf Crescent", subject: "Your shipping bills", body: "Hi Farah,\nWorth fifteen minutes?" });
    expect(email).toContain("To: Farah <farah@gulf.example>, Gulf Crescent");
    expect(email).toContain("Subject: Your shipping bills");
    expect(email).toContain("Hi Farah,\nWorth fifteen minutes?");
    expect(approvalDetail("outreach_email", { hot: true, body: "x" })).toContain("next message");
    expect(approvalDetail("public_post", { poll: { question: "Which one?", options: ["A", "B"] } })).toBe("Poll: Which one?\n  A\n  B");
    expect(approvalDetail("public_post", { body: "Deal text" })).toBe("Post:\nDeal text");
    expect(approvalDetail("decision", { text: "Why this" })).toBe("Why this");
    expect(approvalDetail("floor_unlock", {})).toBe("");
    await raiseApproval(db, { type: "outreach_email", summary: "Send first outreach email to Gulf Crescent", content: { to: "farah@gulf.example", subject: "Your shipping bills", body: "Hi Farah,\nWorth fifteen minutes?" } }, NOW);
    const [m] = await db.select().from(messagesOut).where(and(eq(messagesOut.kind, "approval"), sql`${messagesOut.body} like '%Gulf Crescent%'`)).limit(1);
    expect(m!.body).toContain("Subject: Your shipping bills");
    expect(m!.body).toContain("Worth fifteen minutes?");
  });

  it("cleans dashes out of agent text without touching words, links or greetings", () => {
    expect(plainDashes("Great deal — now AED 89")).toBe("Great deal, now AED 89");
    expect(plainDashes("Save 10–20 percent")).toBe("Save 10 to 20 percent");
    expect(plainDashes("- first\n- second")).toBe("• first\n• second");
    expect(plainDashes("Hi Farah,\nfast - really fast")).toBe("Hi Farah,\nfast, really fast");
    expect(plainDashes("Wi-Fi at https://x.example/a-b on 2026-10-06")).toBe("Wi-Fi at https://x.example/a-b on 2026-10-06");
    expect(plainDashes("Ends today —\nnext line")).toBe("Ends today\nnext line");
  });
});

describe("The Tower asks for the Deals autopilot by itself", () => {
  it("raises it once, never twice in a week, and approving switches the floor", async () => {
    await db.update(floors).set({ status: "live", autoApprove: false }).where(eq(floors.slug, "deals"));
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    expect(await maybeRaiseDealsAutoApprove(db, floor!, NOW)).toBe(true);
    expect(await maybeRaiseDealsAutoApprove(db, floor!, new Date(NOW.getTime() + 3600_000))).toBe(false);
    const [ask] = await db.select().from(approvals).where(eq(approvals.summary, DEALS_AUTO_DECISION));
    expect(ask!.content).toMatchObject({ autoApproveFloor: "deals" });
    await applyApprovalDecision(db, ask!.id, "rejected", "not yet", "telegram", NOW);
    expect(await maybeRaiseDealsAutoApprove(db, floor!, new Date(NOW.getTime() + 2 * 24 * 3600_000))).toBe(false);
    expect(await maybeRaiseDealsAutoApprove(db, floor!, new Date(NOW.getTime() + 8 * 24 * 3600_000))).toBe(true);
    const [again] = await db.select().from(approvals).where(and(eq(approvals.summary, DEALS_AUTO_DECISION), eq(approvals.status, "pending")));
    await applyApprovalDecision(db, again!.id, "approved", null, "telegram", NOW);
    const [on] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    expect(on!.autoApprove).toBe(true);
    expect(await maybeRaiseDealsAutoApprove(db, on!, new Date(NOW.getTime() + 30 * 24 * 3600_000))).toBe(false);
  });
});

describe("The owner answers a lead himself", () => {
  it("sends at once, replaces the drafted answer, and marks the reply answered", async () => {
    expect(senderName("Saaqib Khan <saaqib@docledger.site>")).toBe("Saaqib Khan");
    expect(senderName(null)).toBe("The DocLedger team");
    expect(replySubject("Your shipping bills")).toBe("Re: Your shipping bills");
    expect(replySubject("Re: Your shipping bills")).toBe("Re: Your shipping bills");
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    // A US lead at 03:00 their time: the workers' emails would wait, the owner's goes now.
    const [lead] = await db.insert(leads).values({ floorId: floor!.id, company: "Harbour Line Cargo", dedupeKey: "harbour-line", country: "US", status: "replied", decisionMaker: { name: "Sam", email: "sam@harbourline.example" }, simulated: false }).returning();
    await db.insert(outreach).values({ leadId: lead!.id, step: 1, subject: "Your shipping bills", bodyText: "Hi Sam", status: "replied", replyText: "What does it cost?", sentAt: NOW, replyAt: NOW, simulated: false });
    const [draft] = await db.insert(outreach).values({ leadId: lead!.id, step: 2, subject: "Re: Your shipping bills", bodyText: "Drafted answer", status: "draft", simulated: false }).returning();
    const { id: hotId } = await raiseApproval(db, { type: "outreach_email", summary: "Hot lead: answer Harbour Line Cargo", content: { to: "sam@harbourline.example", company: "Harbour Line Cargo", hot: true, outreachId: draft!.id } }, NOW);
    await db.update(outreach).set({ approvalId: hotId }).where(eq(outreach.id, draft!.id));

    const before = mail.length;
    const night = new Date("2026-10-06T08:00:00Z"); // 04:00 in New York
    const r = await ownerSend(db, "harbour line", "It is 99 USD a month after the free month. Want a call Thursday?", night);
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Sam at Harbour Line Cargo");
    expect(mail.length).toBe(before + 1);
    expect(mail.at(-1)).toMatchObject({ to: ["sam@harbourline.example"], subject: "Re: Your shipping bills" });
    expect(String(mail.at(-1)!.text)).toBe("It is 99 USD a month after the free month. Want a call Thursday?\n\nSaaqib Khan");

    const [hot] = await db.select().from(approvals).where(eq(approvals.id, hotId));
    expect(hot!.status).toBe("rejected");
    expect(hot!.decidedVia).toBe("owner");
    const thread = await db.select().from(outreach).where(eq(outreach.leadId, lead!.id)).orderBy(outreach.step);
    expect(thread.map((o) => o.status)).toEqual(["answered", "rejected", "sent"]);
    expect(thread[2]!.step).toBe(3);
    const [mine] = await db.select().from(approvals).where(eq(approvals.id, thread[2]!.approvalId!));
    expect(mine!.decidedVia).toBe("owner");
    expect(mine!.executedAt).toBeTruthy();
    // his own emails never count toward the workers' trust
    expect((await trustEarned(db)).approvedInARow).toBe(0);
  });

  it("works from Telegram and explains a bad line", async () => {
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    await db.insert(leads).values({ floorId: floor!.id, company: "Pearl Route Logistics", dedupeKey: "pearl-route", country: "AE", status: "contacted", decisionMaker: { name: "Omar", email: "omar@pearlroute.example" }, simulated: false });
    const ok = await processTelegramUpdate(db, { update_id: 900, message: { message_id: 900, text: "/send Pearl Route: Thanks Omar, sending the demo link now.", chat: { id: OWNER } } }, NOW);
    expect(ok.handled).toBe("owner sent");
    const bad = await processTelegramUpdate(db, { update_id: 901, message: { message_id: 901, text: "/send nobody here", chat: { id: OWNER } } }, NOW);
    expect(bad.handled).toBe("send without text");
    const none = await processTelegramUpdate(db, { update_id: 902, message: { message_id: 902, text: "/send Unknown Co: hello", chat: { id: OWNER } } }, NOW);
    expect(none.handled).toBe("owner send failed");
  });
});

describe("A failed Warden run reaches the phone", () => {
  it("alerts once every six hours at most", async () => {
    expect(await alertWardenFailed(db, "the answer was cut off", NOW)).toBe(true);
    expect(await alertWardenFailed(db, "again", new Date(NOW.getTime() + 3600_000))).toBe(false);
    expect(await alertWardenFailed(db, "later", new Date(NOW.getTime() + 7 * 3600_000))).toBe(true);
    const alerts = await db.select().from(messagesOut).where(eq(messagesOut.kind, "warden_failed"));
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.body).not.toMatch(/[—–]/);
  });
});
