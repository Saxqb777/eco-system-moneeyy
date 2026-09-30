import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBatches } from "@/agents/batches";
import { setAnthropicFactory } from "@/agents/client";
import { AUTO_SEND_DECISION, salesFunnel, trustEarned } from "@/agents/docledger-autonomy";
import { advancePipelines } from "@/agents/pipeline";
import { handleTaskBatchResult, submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { approvals, floors, leads, messagesOut, outreach, setupItems, tasks } from "@/db/schema";
import { applyApprovalDecision } from "@/lib/approvals";
import { buildBrief } from "@/lib/brief";
import { encryptSecret } from "@/lib/crypto";
import { recordInboundReply, setEmailTransport } from "@/lib/email";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { applyWardenDecisions } from "@/warden/apply";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const sent: Array<Record<string, unknown>> = [];
const DAY = 24 * 3600 * 1000;
const T0 = new Date("2026-10-06T06:00:00Z"); // 10:00 Dubai
const later = (days: number) => new Date(T0.getTime() + days * DAY);

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

async function runBatch(now: Date) {
  await submitQueuedTasks(db, now);
  await collectBatches(db, now, async (r) => handleTaskBatchResult(db, r, now));
}

async function addLead(company: string, email: string, status = "qualified") {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [lead] = await db.insert(leads).values({ floorId: floor!.id, company, dedupeKey: company.toLowerCase().replace(/\s+/g, "-"), website: `https://${company.toLowerCase().replace(/\s+/g, "")}.example`, segment: "freight_forwarder", city: "Dubai", score: 8, scoreReason: "Customs heavy", status, decisionMaker: { name: `${company.split(" ")[0]} Contact`, title: "Finance Manager", email, research: ["Runs sea freight out of Jebel Ali", "Hires accountants often"], angle: "shipping bills" }, simulated: false }).returning();
  return lead!;
}

// What the Chaser answers depends on the reply text the test put in the thread.
const chaser = (text: string) => {
  if (text.includes("demo next week")) return { action: "propose_times", intent: "interested", summary: "Wants a demo next week and the price", subject: "Re: shipping bills", body: "Happy to show you. Pick a slot: https://cal.com/saaqib/15min. It starts at 99 USD a month after the free month.", demoBooked: false, note: "" };
  if (text.includes("does it read PDFs")) return { action: "follow_up", intent: "question", summary: "Asks whether PDFs work", subject: "Re: shipping bills", body: "Yes, PDFs and photos both work.", demoBooked: false, note: "" };
  if (text.includes("busy season")) return { action: "follow_up", intent: "not_now", summary: "Busy season, later", subject: "Re: shipping bills", body: "Understood, I will check back in a month.", demoBooked: false, note: "" };
  if (text.includes("out of the office")) return { action: "close", intent: "out_of_office", summary: "Away until next week", subject: "", body: "", demoBooked: false, note: "" };
  if (text.includes("remove me")) return { action: "close", intent: "unsubscribe", summary: "Asked to be removed", subject: "", body: "", demoBooked: false, note: "" };
  if (text.includes("check back in")) return { action: "follow_up", intent: "no_reply", summary: "Check in", subject: "Checking back in", body: "Hope the busy season went well.", demoBooked: false, note: "" };
  return { action: "follow_up", intent: "no_reply", summary: "Nudge", subject: "Following up", body: "A short nudge.", demoBooked: false, note: "" };
};

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  setEmailTransport(async (_key, _path, _method, body) => {
    sent.push(body ?? {});
    return { ok: true, status: 200, json: { id: `re_${sent.length}` } };
  });
  setAnthropicFactory(() =>
    fakeAnthropic((params) => {
      const text = JSON.stringify(params.messages[0]?.content ?? "");
      if (text.includes("Exclusion list")) return { leads: [], note: "none" };
      if (text.includes("Write the email")) return { subject: "Your shipping bills", body: "Hi, your month end.\n{preview}\nWorth fifteen minutes?\nReply stop and I will not write again.", personalisation: "", preview: { headline: "Shipping bills, not retyped", intro: "your month end.", points: ["One.", "Two.", "Three."], sampleDocument: "Shipping line bill", sampleFields: [{ field: "Total", value: "AED 1 (example)" }] } };
      if (text.includes("Thread:")) return chaser(text);
      return {};
    }),
  );
  await setSetting(db, "simulation_mode", false);
  await setSetting(db, "pipeline_day_deals", "2026-12-31");
  await paste("anthropic_api_key", "sk-ant-test");
  await paste("docledger_product_facts", "First month free. Base 99 USD a month. Saaqib Khan, Founder.");
  await paste("calendar_link", "https://cal.com/saaqib/15min");
  await paste("resend_api_key", "re_test");
  await paste("resend_from", "Saaqib Khan <saaqib@docledger.site>");
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setEmailTransport(null);
  if (close) await close();
});

describe("DocLedger runs on its own, the owner closes", () => {
  it("earns trust only with ten approvals in a row, then the Tower asks once", async () => {
    const at = (n: number) => new Date(T0.getTime() - (40 - n) * 60_000);
    const add = async (n: number, status: "approved" | "rejected") =>
      db.insert(approvals).values({ type: "outreach_email", status, summary: `email ${n}`, content: {}, decidedAt: at(n), decidedVia: "telegram", executedAt: status === "approved" ? at(n) : null, simulated: false });
    for (let n = 0; n < 3; n += 1) await add(n, "approved");
    await add(3, "rejected");
    expect(await trustEarned(db)).toEqual({ earned: false, approvedInARow: 0 });
    for (let n = 4; n < 13; n += 1) await add(n, "approved");
    expect((await trustEarned(db)).approvedInARow).toBe(9);
    await advancePipelines(db, T0);
    expect(await db.select().from(approvals).where(eq(approvals.summary, AUTO_SEND_DECISION))).toHaveLength(0);

    await add(13, "approved");
    expect((await trustEarned(db)).earned).toBe(true);
    await advancePipelines(db, T0);
    await advancePipelines(db, new Date(T0.getTime() + 3600_000));
    const asks = await db.select().from(approvals).where(eq(approvals.summary, AUTO_SEND_DECISION));
    expect(asks).toHaveLength(1);
    expect(asks[0]!.content).toMatchObject({ autoApproveFloor: "docledger" });

    // Warden may not switch it on by itself.
    const summary = await applyWardenDecisions(db, "run-test", { summary: "", assignments: [], reviews: [], strategyNotes: [], ideaActions: [], budgetMoves: [], approvalsToRaise: [{ type: "decision", summary: "Auto approve docledger emails", riskNote: "", content: "docledger floor" }], messagesToOwner: [], blockedResolutions: [] }, T0);
    expect(summary.skipped).toContain("auto send for DocLedger is raised by the Tower at the trust point");

    await applyApprovalDecision(db, asks[0]!.id, "approved", null, "telegram", T0);
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    expect(floor!.autoApprove).toBe(true);
  });

  it("sends routine first emails on its own, up to the daily cap", async () => {
    await setSetting(db, "docledger_auto_send_cap", 1);
    await addLead("Gulf Crescent Freight", "farah@gulfcrescent.example");
    await addLead("Pearl Route Logistics", "omar@pearlroute.example");
    await advancePipelines(db, T0);
    await runBatch(T0);
    const firsts = await db.select().from(approvals).where(and(eq(approvals.type, "outreach_email"), sql`${approvals.summary} like 'Send first outreach email%'`));
    expect(firsts.map((a) => a.decidedVia ?? a.status).sort()).toEqual(["auto", "pending"]);
    await advancePipelines(db, T0);
    expect(sent).toHaveLength(1);
    await setSetting(db, "docledger_auto_send_cap", 15);
  });

  it("sends a hot reply to the owner with their words and a suggested answer, never on its own", async () => {
    const [first] = await db.select().from(outreach).where(eq(outreach.status, "sent")).limit(1);
    const [lead] = await db.select().from(leads).where(eq(leads.id, first!.leadId!)).limit(1);
    const email = (lead!.decisionMaker as { email: string }).email;
    await recordInboundReply(db, { from: email, subject: "Re: Your shipping bills", text: "Looks useful. Can we do a demo next week? What does it cost?" }, later(1));
    await advancePipelines(db, later(1));
    await runBatch(later(1));
    const [hot] = await db.select().from(approvals).where(sql`${approvals.summary} like 'Hot lead: answer%'`);
    expect(hot!.status).toBe("pending");
    expect(hot!.summary).toContain("Wants a demo next week and the price");
    expect((hot!.content as { hot: boolean }).hot).toBe(true);
    const [alert] = await db.select().from(messagesOut).where(eq(messagesOut.kind, "hot_lead"));
    expect(alert!.body).toContain("They wrote:\nLooks useful. Can we do a demo next week? What does it cost?");
    expect(alert!.body).toContain("It starts at 99 USD a month after the free month.");
    const brief = await buildBrief(db, later(1));
    expect(brief.needs).toContain("1 hot DocLedger lead waiting for you to close");
  });

  it("answers a simple question on its own", async () => {
    const lead = await addLead("Harbour Line Cargo", "sam@harbourline.example", "contacted");
    await db.insert(outreach).values({ leadId: lead.id, step: 1, channel: "email", subject: "Your shipping bills", bodyText: "Hi", status: "sent", sentAt: later(1), simulated: false });
    await recordInboundReply(db, { from: "sam@harbourline.example", subject: "Re", text: "Quick one: does it read PDFs from the shipping line?" }, later(2));
    await advancePipelines(db, later(2));
    await runBatch(later(2));
    const [answer] = await db.select().from(approvals).where(sql`${approvals.summary} like 'Send follow up 2 to%' and ${approvals.content} ->> 'company' = 'Harbour Line Cargo'`);
    expect(answer!.decidedVia).toBe("auto");
  });

  it("pauses on not now and on out of office, then checks back in when the pause ends", async () => {
    const busy = await addLead("Desert Link Shipping", "ali@desertlink.example", "contacted");
    await db.insert(outreach).values({ leadId: busy.id, step: 1, channel: "email", subject: "Your shipping bills", bodyText: "Hi", status: "sent", sentAt: later(1), simulated: false });
    const away = await addLead("Creek Side Forwarding", "mo@creekside.example", "contacted");
    await db.insert(outreach).values({ leadId: away.id, step: 1, channel: "email", subject: "Your shipping bills", bodyText: "Hi", status: "sent", sentAt: later(1), simulated: false });
    await recordInboundReply(db, { from: "ali@desertlink.example", subject: "Re", text: "It is our busy season, try me later." }, later(2));
    await recordInboundReply(db, { from: "mo@creekside.example", subject: "Automatic reply", text: "I am out of the office until next week." }, later(2));
    await advancePipelines(db, later(2));
    await runBatch(later(2));
    const [busyLead] = await db.select().from(leads).where(eq(leads.id, busy.id)).limit(1);
    const [awayLead] = await db.select().from(leads).where(eq(leads.id, away.id)).limit(1);
    expect((busyLead!.decisionMaker as { snoozeUntil?: string }).snoozeUntil).toBeTruthy();
    expect((awayLead!.decisionMaker as { snoozeUntil?: string }).snoozeUntil).toBeTruthy();
    expect(awayLead!.status).not.toBe("lost");
    const awayApprovals = await db.select().from(approvals).where(sql`${approvals.content} ->> 'company' = 'Creek Side Forwarding'`);
    expect(awayApprovals).toHaveLength(0);

    // Out of office wakes after a week, not now after a month; no nudges in between.
    await advancePipelines(db, later(6));
    const checkIns = async () => (await db.select().from(tasks).where(and(eq(tasks.kind, "follow_up"), sql`${tasks.input} ->> 'mode' = 'check_in'`))).map((t) => t.title);
    expect(await checkIns()).toEqual([]);
    await advancePipelines(db, later(10));
    expect(await checkIns()).toEqual(["Check back in with Creek Side Forwarding"]);
    await advancePipelines(db, later(33));
    expect((await checkIns()).sort()).toEqual(["Check back in with Creek Side Forwarding", "Check back in with Desert Link Shipping"]);
  });

  it("closes a lead that asks to be removed", async () => {
    const lead = await addLead("Marina Cargo", "zed@marinacargo.example", "contacted");
    await db.insert(outreach).values({ leadId: lead.id, step: 1, channel: "email", subject: "Your shipping bills", bodyText: "Hi", status: "sent", sentAt: later(1), simulated: false });
    await recordInboundReply(db, { from: "zed@marinacargo.example", subject: "Re", text: "Please remove me from your list." }, later(34));
    await advancePipelines(db, later(34));
    await runBatch(later(34));
    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
    expect(after!.status).toBe("lost");
  });

  it("reads the funnel like a sales manager", async () => {
    const f = await salesFunnel(db, later(1));
    expect(f.autoSend).toBe(true);
    expect(f.sentWeek).toBeGreaterThanOrEqual(1);
    expect(f.hotOpen).toBe(1);
  });
});
