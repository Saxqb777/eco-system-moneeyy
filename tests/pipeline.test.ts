import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBatches } from "@/agents/batches";
import { setAnthropicFactory } from "@/agents/client";
import { advancePipelines } from "@/agents/pipeline";
import { handleTaskBatchResult, submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { agents, approvals, floors, leads, messagesOut, outreach, setupItems, tasks, tickets } from "@/db/schema";
import { applyApprovalDecision } from "@/lib/approvals";
import { finishBuilderTicket, nextBuilderJob, startBuilderTicket } from "@/lib/builder";
import { encryptSecret } from "@/lib/crypto";
import { recordInboundReply, setEmailTransport, verifyWebhookSignature } from "@/lib/email";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";
import { createHmac } from "node:crypto";

let db: Db;
let close: () => Promise<void>;
const MORNING = new Date("2026-10-06T06:00:00Z"); // 10:00 Dubai, Tuesday, inside business hours

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  await setSetting(db, "simulation_mode", false);
  await paste("anthropic_api_key", "sk-ant-test");
  await paste("docledger_product_facts", "DocLedger keeps every shipping document in one ledger. 99 USD a month. Saaqib Khan, founder.");
  await paste("calendar_link", "https://cal.com/saaqib/15min");
  // This file is about DocLedger only: keep the Deals floor quiet.
  await db.update(floors).set({ status: "paused" }).where(eq(floors.slug, "deals"));
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setEmailTransport(null);
  if (close) await close();
});

const agentBySlug = async (slug: string) => (await db.select().from(agents).where(eq(agents.slug, slug)).limit(1))[0]!;

describe("DocLedger pipeline", () => {
  it("queues the morning scout run once a day", async () => {
    const a = await advancePipelines(db, MORNING);
    expect(a.created.find_leads).toBe(1);
    const again = await advancePipelines(db, new Date(MORNING.getTime() + 60_000));
    expect(again.created.find_leads).toBeUndefined();
  });

  it("submits the scout as a batch and absorbs the leads it found", async () => {
    const fake = fakeAnthropic((params) => {
      const text = JSON.stringify(params.messages[0]?.content ?? "");
      if (text.includes("Exclusion list")) {
        return { leads: [{ company: "Gulf Crescent Freight", website: "https://gulfcrescent.example", segment: "freight_forwarder", city: "Jebel Ali", country: "AE", sourceUrl: "https://directory.example/a", phone: "", why: "Small forwarder with customs work" }, { company: "Pearl Route Logistics", website: "https://pearlroute.example", segment: "small_3pl", city: "Dubai", country: "AE", sourceUrl: "https://directory.example/b", phone: "", why: "3PL" }], note: "Two decent finds" };
      }
      if (text.includes("Qualify this company")) {
        const pearl = text.includes("Pearl Route");
        return { score: 8, reason: "Customs heavy forwarder", qualified: true, decisionMaker: { name: pearl ? "Omar Nair" : "Farah Haddad", title: "Operations Manager", email: pearl ? "omar@pearlroute.example" : "farah@gulfcrescent.example", linkedin: "", confidence: 0.7 }, notes: "" };
      }
      if (text.includes("Write the email")) return { subject: "Customs documents at Jebel Ali", body: "Hi Farah, your month end.\n{preview}\nWorth fifteen minutes?\nSaaqib Khan\nReply stop and I will not write again.", personalisation: "Jebel Ali", preview: { headline: "Forty shipping bills, none retyped", intro: "your month end at Gulf Crescent ends with a pile of Maersk bills.", points: ["Photograph the bill, the fields fill themselves.", "Charge lines add up and cross check the invoice.", "Your own document types when ours do not fit."], sampleDocument: "Shipping line bill, Maersk, Jebel Ali", sampleFields: [{ field: "BL number", value: "MAEU123456 (example)" }, { field: "Container", value: "MSKU7654321 (example)" }, { field: "Total", value: "AED 4,120 (example)" }] } };
      if (text.includes("Thread:")) return { action: "propose_times", subject: "Re: Customs documents at Jebel Ali", body: "Great, pick a slot here: https://cal.com/saaqib/15min", demoBooked: false, note: "warm" };
      return {};
    });
    setAnthropicFactory(() => fake);
    const submitted = await submitQueuedTasks(db, MORNING);
    expect(submitted.submitted).toBe(1);
    const scout = await agentBySlug("docledger_scout");
    expect(scout.status).toBe("working");
    expect(fake.batches.size).toBe(1);
    const req = [...fake.batches.values()][0]![0]!;
    expect(req.params.tools?.[0]).toMatchObject({ type: "web_search_20260318", max_uses: 5 });
    expect(req.params.output_config?.format?.type).toBe("json_schema");

    await collectBatches(db, MORNING, async (r) => handleTaskBatchResult(db, r, MORNING));
    const found = await db.select().from(leads).where(eq(leads.simulated, false));
    expect(found).toHaveLength(2);
    const [scoutTask] = await db.select().from(tasks).where(and(eq(tasks.kind, "find_leads"), eq(tasks.simulated, false)));
    expect(scoutTask!.status).toBe("review");
    expect((scoutTask!.output as { found: number }).found).toBe(2);
    expect((await agentBySlug("docledger_scout")).status).toBe("idle");
  });

  it("qualifies, drafts, rings the phone, sends on approval, then chases the reply", async () => {
    // analyst tasks for the two new leads
    const a1 = await advancePipelines(db, MORNING);
    expect(a1.created.qualify_lead).toBe(2);
    await submitQueuedTasks(db, MORNING);
    await collectBatches(db, MORNING, async (r) => handleTaskBatchResult(db, r, MORNING));
    const qualified = await db.select().from(leads).where(eq(leads.status, "qualified"));
    expect(qualified).toHaveLength(2);
    expect(qualified.map((l) => (l.decisionMaker as { email: string }).email).sort()).toEqual(["farah@gulfcrescent.example", "omar@pearlroute.example"]);

    // writer drafts, approval item raised, Telegram queued
    const a2 = await advancePipelines(db, MORNING);
    expect(a2.created.draft_outreach).toBe(2);
    await submitQueuedTasks(db, MORNING);
    await collectBatches(db, MORNING, async (r) => handleTaskBatchResult(db, r, MORNING));
    const drafts = await db.select().from(outreach).where(eq(outreach.simulated, false));
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.approvalId).toBeTruthy();
    expect(drafts[0]!.bodyText).toMatch(/A two minute preview made for .*: https?:\/\/\S+\/for\/[a-z0-9]{6}/);
    expect(drafts[0]!.bodyText).not.toContain("{preview}");
    const withPreview = await db.select().from(leads).where(eq(leads.simulated, false));
    expect(withPreview.every((l) => l.previewCode && (l.preview as { points: string[] }).points.length === 3)).toBe(true);
    const pending = await db.select().from(approvals).where(and(eq(approvals.type, "outreach_email"), eq(approvals.status, "pending"), eq(approvals.simulated, false)));
    expect(pending).toHaveLength(2);
    expect((await db.select().from(messagesOut).where(eq(messagesOut.kind, "approval"))).length).toBeGreaterThanOrEqual(2);

    // approve without Resend: deferred, then Resend arrives and the advance step sends it
    const first = pending.find((p) => (p.content as { to: string }).to === "farah@gulfcrescent.example")!;
    await applyApprovalDecision(db, first.id, "approved", null, "ui", MORNING);
    const [afterApprove] = await db.select().from(approvals).where(eq(approvals.id, first.id)).limit(1);
    expect(afterApprove!.executedAt).toBeNull();
    expect((afterApprove!.executionResult as { deferred: string }).deferred).toMatch(/Resend/);
    const sends: Array<Record<string, unknown>> = [];
    setEmailTransport(async (_k, path, method, body) => {
      if (path === "/emails" && method === "POST") {
        sends.push(body ?? {});
        return { ok: true, status: 200, json: { id: "re_123" } };
      }
      return { ok: false, status: 404, json: null };
    });
    await paste("resend_api_key", "re_test");
    await paste("resend_from", "saaqib@docledger.example");
    const a3 = await advancePipelines(db, MORNING);
    expect(a3.executed).toBe(1);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.to).toEqual(["farah@gulfcrescent.example"]);
    const [sentRow] = await db.select().from(outreach).where(eq(outreach.approvalId, first.id)).limit(1);
    expect(sentRow!.status).toBe("sent");
    expect(sentRow!.resendId).toBe("re_123");
    const [contacted] = await db.select().from(leads).where(eq(leads.id, sentRow!.leadId!)).limit(1);
    expect(contacted!.status).toBe("contacted");

    // a reply comes in through the webhook path
    const reply = await recordInboundReply(db, { from: "Farah Haddad <farah@gulfcrescent.example>", subject: "Re: Customs documents", text: "Sounds interesting, send me some times." }, new Date(MORNING.getTime() + 3600_000));
    expect(reply.matched).toBe(true);
    const a4 = await advancePipelines(db, new Date(MORNING.getTime() + 3600_000));
    expect(a4.created.follow_up).toBe(1);
    await submitQueuedTasks(db, new Date(MORNING.getTime() + 3600_000));
    await collectBatches(db, MORNING, async (r) => handleTaskBatchResult(db, r, new Date(MORNING.getTime() + 3700_000)));
    const thread = await db.select().from(outreach).where(eq(outreach.leadId, sentRow!.leadId!)).orderBy(outreach.step);
    expect(thread).toHaveLength(2);
    expect(thread[1]!.step).toBe(2);
    expect(thread[1]!.status).toBe("draft");
    const unmatched = await recordInboundReply(db, { from: "nobody@gmail.com", subject: "hi", text: "who is this" }, MORNING);
    expect(unmatched.matched).toBe(false);
  });

  it("holds a floor that is near its share of the cap", async () => {
    await setSetting(db, "daily_cap_usd", 0.01);
    const held = await submitQueuedTasks(db, MORNING);
    expect(["held", "idle"]).toContain(held.status);
    await setSetting(db, "daily_cap_usd", 1.7);
  });

  it("verifies Resend webhook signatures", () => {
    const secret = `whsec_${Buffer.from("topsecret").toString("base64")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.received"}';
    const sig = createHmac("sha256", Buffer.from("topsecret")).update(`msg_1.${ts}.${body}`).digest("base64");
    expect(verifyWebhookSignature(secret, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, body)).toBe(true);
    expect(verifyWebhookSignature(secret, { id: "msg_1", timestamp: ts, signature: "v1,AAAA" }, body)).toBe(false);
    expect(verifyWebhookSignature(secret, { id: "msg_1", timestamp: "100", signature: `v1,${sig}` }, body)).toBe(false);
  });

  it("hands Builder the top ticket and records the pull request", async () => {
    expect((await nextBuilderJob(db)).reason).toMatch(/repo URL/);
    await paste("docledger_repo_url", "https://github.com/Saxqb777/docledger");
    expect((await nextBuilderJob(db)).reason).toMatch(/empty/);
    const [t] = await db.insert(tickets).values({ source: "warden", title: "Fix invoice export", description: "Totals are off by the VAT line", repo: "Saxqb777/docledger", status: "backlog", simulated: false }).returning();
    const { job } = await nextBuilderJob(db);
    expect(job?.ticket.id).toBe(t!.id);
    expect(job?.caps).toEqual({ toolCalls: 25, usd: 0.4, minutes: 20 });
    await startBuilderTicket(db, t!.id, MORNING);
    expect((await agentBySlug("docledger_builder")).status).toBe("working");
    await finishBuilderTicket(db, { ticketId: t!.id, status: "pr_open", branch: "builder/fix-invoice-export-abc123", prUrl: "https://github.com/Saxqb777/docledger/pull/9", summary: "Added the VAT line to the total.", usage: { inputTokens: 40000, outputTokens: 6000, costUsd: 0.14, durationMs: 300000, toolCalls: 12, model: "claude-sonnet-5-5" } }, MORNING);
    const [done] = await db.select().from(tickets).where(eq(tickets.id, t!.id)).limit(1);
    expect(done!.status).toBe("pr_open");
    expect(done!.approvalId).toBeTruthy();
    const [pr] = await db.select().from(approvals).where(eq(approvals.id, done!.approvalId!)).limit(1);
    expect(pr!.type).toBe("pull_request");
    await applyApprovalDecision(db, pr!.id, "approved", null, "ui", MORNING);
    const [approved] = await db.select().from(tickets).where(eq(tickets.id, t!.id)).limit(1);
    expect(approved!.status).toBe("approved");
    expect((await agentBySlug("docledger_builder")).status).toBe("idle");
  });
});
