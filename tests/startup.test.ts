import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBatches } from "@/agents/batches";
import { setAnthropicFactory } from "@/agents/client";
import { DOCLEDGER } from "@/config/docledger";
import { activeExperiments, experimentLines } from "@/agents/experiments";
import { advanceGrowth, founderNumbers, formatFounderReport, ownerMarksLead, standUp } from "@/agents/growth";
import { handleTaskBatchResult, submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { agents, approvals, floors, leads, messagesOut, outreach, revenue, setupItems, tasks, tickets } from "@/db/schema";
import { applyApprovalDecision } from "@/lib/approvals";
import { buildBrief, formatBrief } from "@/lib/brief";
import { floorShare } from "@/lib/budget";
import { encryptSecret } from "@/lib/crypto";
import { getSettings, setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { processTelegramUpdate } from "@/lib/telegram-inbound";
import { docledgerBase, siteLine, siteRoute } from "@/lib/site";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let fake: ReturnType<typeof fakeAnthropic>;
const NOW = new Date("2026-10-06T08:00:00Z"); // 12:00 Dubai
const DAY = 24 * 3600 * 1000;
const OWNER = "4242";

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

async function run(now: Date) {
  await submitQueuedTasks(db, now);
  await collectBatches(db, now, async (r) => handleTaskBatchResult(db, r, now));
}

const ideasAnswer = {
  ideas: [
    { title: "Partner with bookkeeping firms — Dubai", why: "Replies say their accountant keys the bills.", experiment: "Write to ten firms.", metric: "partner calls booked", owner: "partners", instructions: "Focus on bookkeeping firms with logistics clients in Dubai.", days: 14 },
    { title: "Lead with the port in the subject", why: "Local detail gets opened.", experiment: "Writer names the port.", metric: "reply rate", owner: "writer", instructions: "Name the company's main port in the subject line.", days: 30 },
    { title: "Bad owner", why: "x", experiment: "x", metric: "x", owner: "janitor", instructions: "x", days: 7 },
  ],
  note: "Two ideas today",
};

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  fake = fakeAnthropic((params) => {
    const text = JSON.stringify(params.messages[0]?.content ?? "");
    if (text.includes("Bring today's ideas")) return ideasAnswer;
    if (text.includes("Find partners and return")) {
      return {
        partners: [
          { company: "Ledger Lane Accounting", kind: "accounting_firm", website: "https://ledgerlane.example", country: "AE", city: "Dubai", contactName: "Mira", email: "info@ledgerlane.example", why: "Bookkeeping for freight forwarders", sourceUrl: "https://directory.example/ledgerlane", subject: "Your clients' shipping bills", body: "Hi Mira,\nWe help your logistics clients stop retyping bills — a short call?\nReply stop and we will not write again." },
          { company: "Berlin Books", kind: "accounting_firm", website: "https://berlinbooks.example", country: "DE", city: "Berlin", contactName: "", email: "hallo@berlinbooks.example", why: "x", sourceUrl: "https://directory.example/bb", subject: "x", body: "x" },
          { company: "No Mail Co", kind: "association", website: "", country: "AE", city: "", contactName: "", email: "", why: "x", sourceUrl: "https://x.example", subject: "x", body: "x" },
        ],
        note: "one good one",
      };
    }
    if (text.includes("Update the roadmap and return")) return { roadmap: [{ title: "Read PDF bills from shipping lines", why: "Asked twice", evidence: "Harbour Line asked about PDFs", priority: "now" }], ticket: { title: "Accept PDF shipping bills", description: "Let users upload a PDF bill.", acceptance: "A PDF bill fills the same fields as a photo." }, note: "" };
    if (text.includes("Write this week's material")) return { linkedin: [{ hook: "Month end — the envelope", body: "Every forwarder knows the envelope of receipts." }, { hook: "What we learned", body: "Accountants key the bills." }], listing: { tagline: "Receipts into accounts", description: "Doc Ledger reads bills.", categories: ["Accounting", "Expense management"] }, page: { headline: "Stop retyping shipping bills", subheadline: "Photograph it, check it, done.", points: ["One", "Two", "Three"], cta: "Book a call" }, note: "" };
    if (text.includes("This email: Welcome")) return { subject: "Welcome to Doc Ledger", body: "Hi Sam,\nThree things to try this week." };
    if (text.includes("This email: Day 3")) return { subject: "How are the first bills going?", body: "Hi Sam,\nOne question." };
    return {};
  });
  setAnthropicFactory(() => fake);
  await setSetting(db, "simulation_mode", false);
  await setSetting(db, "pipeline_day_docledger", "2026-10-06"); // keep the sales floor quiet
  await paste("anthropic_api_key", "sk-ant-test");
  await paste("telegram_bot_token", "123:abc");
  await paste("telegram_chat_id", OWNER);
  await paste("resend_api_key", "re_test");
  await paste("resend_from", "Saaqib Khan <saaqib@docledger.site>");
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  if (close) await close();
});

describe("The DocLedger Growth floor", () => {
  it("is part of the building with six people, and the Deals Engine is archived", async () => {
    const [growth] = await db.select().from(floors).where(eq(floors.slug, "growth")).limit(1);
    expect(growth!.status).toBe("live");
    expect(growth!.level).toBe(3);
    const crew = await db.select().from(agents).where(eq(agents.floorId, growth!.id));
    expect(crew.map((a) => a.slug).sort()).toEqual(["growth_finance", "growth_lead", "growth_marketer", "growth_partners", "growth_product", "growth_success"]);
    const [dealsFloor] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    expect(dealsFloor!.status).toBe("archived");
    const s = await getSettings(db);
    expect(floorShare(s, "docledger")).toBe(0.55);
    expect(floorShare(s, "growth")).toBe(0.25);
    expect(floorShare(s, "content")).toBe(0.4);
  });

  it("starts everyone's day once, with Finance counting and reporting without a model", async () => {
    const created: Record<string, number> = {};
    await advanceGrowth(db, NOW, created);
    expect(created).toMatchObject({ growth_ideas: 1, find_partners: 1, product_review: 1, marketing_pack: 1, founder_report: 1 });
    const again: Record<string, number> = {};
    await advanceGrowth(db, new Date(NOW.getTime() + 15 * 60_000), again);
    expect(again).toEqual({});
    const [report] = await db.select().from(messagesOut).where(eq(messagesOut.kind, "founder_report"));
    expect(report!.body).toContain("Founder report from Finance");
    expect(report!.body).not.toMatch(/[—–]/);
    const [finance] = await db.select().from(tasks).where(eq(tasks.kind, "founder_report"));
    expect(finance!.status).toBe("done");
  });

  it("brings at most three ideas a day, cleaned, and never one with an unknown owner", async () => {
    await run(NOW);
    const ideas = await db.select().from(approvals).where(and(eq(approvals.type, "decision"), sql`(${approvals.content} -> 'growthIdea') is not null`));
    expect(ideas.map((i) => i.summary).sort()).toEqual(["Idea: Lead with the port in the subject", "Idea: Partner with bookkeeping firms, Dubai"]);
    const [m] = await db.select().from(messagesOut).where(and(eq(messagesOut.kind, "approval"), sql`${messagesOut.body} like '%bookkeeping firms%'`));
    expect(m!.body).toContain("The test: Write to ten firms.");
  });

  it("turns an approved idea into an experiment the teammate follows", async () => {
    const [idea] = await db.select().from(approvals).where(eq(approvals.summary, "Idea: Partner with bookkeeping firms, Dubai"));
    await applyApprovalDecision(db, idea!.id, "approved", null, "telegram", NOW);
    const running = await activeExperiments(db, NOW);
    expect(running).toHaveLength(1);
    expect(running[0]!.owner).toBe("partners");
    expect(await experimentLines(db, NOW, "partners")).toContain("bookkeeping firms with logistics clients");
    expect(await experimentLines(db, NOW, "writer")).toBe("");
    const [push] = await db.select().from(tasks).where(and(eq(tasks.kind, "find_partners"), sql`${tasks.title} like 'Experiment:%'`));
    expect(push).toBeTruthy();
    // The writer idea runs for at most 21 days, whatever the model asked for.
    const [writerIdea] = await db.select().from(approvals).where(eq(approvals.summary, "Idea: Lead with the port in the subject"));
    await applyApprovalDecision(db, writerIdea!.id, "approved", null, "telegram", NOW);
    const writerExp = (await activeExperiments(db, NOW, "writer"))[0]!;
    expect(Date.parse(writerExp.endsAt) - NOW.getTime()).toBe(21 * DAY);
    expect(await activeExperiments(db, new Date(NOW.getTime() + 22 * DAY), "writer")).toHaveLength(0);
  });

  it("finds real partners with an email, skips the skip list, and never sends without the owner", async () => {
    const partners = await db.select().from(leads).where(sql`${leads.segment} like 'partner%'`);
    expect(partners.map((p) => p.company)).toEqual(["Ledger Lane Accounting"]);
    expect(partners[0]!.status).toBe("drafted");
    const [ap] = await db.select().from(approvals).where(eq(approvals.summary, "Send partner email to Ledger Lane Accounting"));
    expect(ap!.status).toBe("pending");
    expect((ap!.content as { body: string }).body).not.toMatch(/[—–]/);
    const [draft] = await db.select().from(outreach).where(eq(outreach.leadId, partners[0]!.id));
    expect(draft!.approvalId).toBe(ap!.id);
  });

  it("keeps the roadmap and puts a ticket in Builder's queue only on the owner's yes", async () => {
    const s = await getSettings(db);
    expect((s.docledger_roadmap as { items: Array<{ title: string }> }).items[0]!.title).toBe("Read PDF bills from shipping lines");
    const [t] = await db.select().from(tickets).where(eq(tickets.title, "Accept PDF shipping bills"));
    expect(t!.status).toBe("proposed");
    const [ap] = await db.select().from(approvals).where(eq(approvals.summary, "Build: Accept PDF shipping bills"));
    await applyApprovalDecision(db, ap!.id, "approved", null, "telegram", NOW);
    const [after] = await db.select().from(tickets).where(eq(tickets.id, t!.id));
    expect(after!.status).toBe("backlog");
  });

  it("writes the week's posts for the owner to publish himself", async () => {
    const s = await getSettings(db);
    const pack = s.docledger_marketing as { linkedin: Array<{ hook: string }>; page: { headline: string } };
    expect(pack.linkedin).toHaveLength(2);
    expect(pack.linkedin[0]!.hook).toBe("Month end, the envelope");
    expect(pack.page.headline).toBe("Stop retyping shipping bills");
    const [m] = await db.select().from(messagesOut).where(eq(messagesOut.kind, "marketing"));
    expect(m!.body).toContain("ready for you to post");
  });

  it("looks after a company in its free month, then books the paying customer", async () => {
    const [sales] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    await db.insert(leads).values({ floorId: sales!.id, company: "Harbour Line Cargo", dedupeKey: "harbour-line-startup", country: "AE", status: "demo_booked", decisionMaker: { name: "Sam", email: "sam@harbourline.example" }, simulated: false });
    const bad = await ownerMarksLead(db, "won", "Harbour Line", null, NOW);
    expect(bad.ok).toBe(false);
    const trial = await ownerMarksLead(db, "trial", "harbour line", null, NOW);
    expect(trial.ok).toBe(true);
    const created: Record<string, number> = {};
    await advanceGrowth(db, new Date(NOW.getTime() + 60_000), created);
    expect(created.success_email).toBe(1);
    await run(new Date(NOW.getTime() + 60_000));
    const [welcome] = await db.select().from(approvals).where(eq(approvals.summary, "Welcome for Harbour Line Cargo"));
    expect(welcome!.status).toBe("pending");
    // Nothing more until day 3.
    const quiet: Record<string, number> = {};
    await advanceGrowth(db, new Date(NOW.getTime() + DAY), quiet);
    expect(quiet.success_email).toBeUndefined();
    const day3: Record<string, number> = {};
    await advanceGrowth(db, new Date(NOW.getTime() + 3 * DAY + 60_000), day3);
    expect(day3.success_email).toBe(1);

    const won = await ownerMarksLead(db, "won", "Harbour Line Cargo", 99, new Date(NOW.getTime() + 20 * DAY));
    expect(won.message).toContain("Monthly revenue now 99.00 USD from 1 customer");
    const [rev] = await db.select().from(revenue).where(eq(revenue.source, "docledger_subscription"));
    expect(rev!.verified).toBe(true);
    const f = await founderNumbers(db, new Date(NOW.getTime() + 20 * DAY));
    expect(f.clients).toBe(1);
    expect(f.mrrUsd).toBe(99);
    expect(formatFounderReport(f)).toContain("paying customers: 1");
  });

  it("takes /trial, /won and /lost from the phone", async () => {
    const [sales] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    await db.insert(leads).values({ floorId: sales!.id, company: "Pearl Route Logistics", dedupeKey: "pearl-route-startup", country: "AE", status: "contacted", decisionMaker: { name: "Omar", email: "omar@pearlroute.example" }, simulated: false });
    expect((await processTelegramUpdate(db, { update_id: 800, message: { message_id: 800, text: "/trial Pearl Route", chat: { id: OWNER } } }, NOW)).handled).toBe("lead trial");
    expect((await processTelegramUpdate(db, { update_id: 801, message: { message_id: 801, text: "/won Pearl Route Logistics 149 USD", chat: { id: OWNER } } }, NOW)).handled).toBe("lead won");
    const [p] = await db.select().from(leads).where(eq(leads.company, "Pearl Route Logistics"));
    expect(p!.status).toBe("client");
    expect((p!.decisionMaker as { monthlyUsd: number }).monthlyUsd).toBe(149);
    expect((await processTelegramUpdate(db, { update_id: 802, message: { message_id: 802, text: "/lost Nobody Inc", chat: { id: OWNER } } }, NOW)).handled).toBe("lost failed");
  });

  it("puts the team's last 24 hours in the morning brief", async () => {
    const lines = await standUp(db, new Date(NOW.getTime() + 60 * 60_000));
    expect(lines.some((l) => l.startsWith("Growth: 1 done"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Partners:"))).toBe(true);
    const brief = await buildBrief(db, new Date(NOW.getTime() + 60 * 60_000));
    expect(formatBrief(brief)).toContain("Stand up, the last 24 hours:");
  });

  it("serves docledger.site as the company's own page, with previews, and never the Tower", async () => {
    expect(siteRoute("docledger.site", "/")).toEqual({ action: "rewrite", to: "/docledger" });
    expect(siteRoute("docledger.site", "/for/abc123")).toEqual({ action: "next" });
    expect(siteRoute("docledger.site", "/api/state")).toEqual({ action: "redirect", to: "https://docledger.site/" });
    expect(siteRoute("DocLedger.site:443", "/login")).toEqual({ action: "redirect", to: "https://docledger.site/" });
    expect(siteRoute("www.docledger.site", "/for/abc123")).toEqual({ action: "redirect", to: "https://docledger.site/for/abc123" });
    expect(siteRoute("the-tower-saxqb777s-projects.vercel.app", "/")).toEqual({ action: "tower" });
    // Preview links move to the site only once it is switched on.
    expect(await docledgerBase(db)).toMatch(/vercel\.app$/);
    expect(await siteLine(db)).toBe("");
    await setSetting(db, "docledger_site_url", "https://docledger.site/");
    expect(await docledgerBase(db)).toBe("https://docledger.site");
    expect(await siteLine(db)).toBe("\nCompany website: https://docledger.site");
    await setSetting(db, "docledger_site_url", null);
    // The public pages speak to the reader: no notes meant for the workers, no dashes (rule 7).
    for (const text of Object.values(DOCLEDGER.publicCopy)) {
      expect(text).not.toMatch(/Say that|when they describe|a customer|Couriers, airlines/);
      expect(text).not.toMatch(/[\u2013\u2014]| - /);
    }
  });
});
