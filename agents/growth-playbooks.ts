// DocLedger Growth floor (D065): the people who grow the company around the sales team. Head of Growth brings ideas,
// Partners finds firms that refer clients, Product keeps the roadmap and writes Builder tickets, Marketer writes
// what the founder posts, Success looks after companies in their free month. Every email and every ticket still
// goes to the owner's phone first; Marketer's material is for him to post himself.
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { appBaseUrl, appUsageByCode, usageLine } from "@/lib/app-usage";
import type { Db } from "@/db/client";
import { approvals, floors, leads, outreach, tasks, tickets } from "@/db/schema";
import { DOCLEDGER, PARTNER_OFFER, docledgerKnowledge } from "@/config/docledger";
import { RESEARCH_EFFORT } from "@/config/models";
import { raiseApproval } from "@/lib/approvals";
import { clipboardValue } from "@/lib/clipboard";
import { normaliseCountry, regionFor, skippedCountries } from "@/lib/markets";
import { getSettings, setSetting } from "@/lib/settings";
import { enqueueMessage } from "@/lib/telegram";
import { plainDashes } from "@/lib/text";
import { siteLine } from "@/lib/site";
import { salesFunnel } from "./docledger-autonomy";
import { IDEA_OWNERS, OWNER_LABEL, allExperiments, experimentLines, isIdeaOwner, type GrowthIdea } from "./experiments";
import { STYLE, input, logEvent, num, str, type Playbook } from "./playbook-core";

const DAY_MS = 24 * 3600 * 1000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MAX_PENDING_IDEAS = 3;

export interface RoadmapItem {
  title: string;
  why: string;
  evidence: string;
  priority: "now" | "next" | "later";
}

export interface MarketingPack {
  at: string;
  linkedin: Array<{ hook: string; body: string }>;
  listing: { tagline: string; description: string; categories: string[] };
  page: { headline: string; subheadline: string; points: string[]; cta: string };
}

// D080: welcome on day 0, did the first bill read right on day 3, a usage check on day 10, the paid offer on day 25
// (the free month ends on day 30 and the Billing page takes the card).
export const SUCCESS_STEPS = [
  { key: "welcome", day: 0, label: "Welcome" },
  { key: "day3", day: 3, label: "Day 3 check in" },
  { key: "day10", day: 10, label: "Day 10 usage check" },
  { key: "offer", day: 25, label: "Paid offer" },
] as const;
export type SuccessStep = (typeof SUCCESS_STEPS)[number]["key"];

// The owner's price line and signature, and the postal address when pasted (the same facts the Writer uses).
async function ownerFacts(db: Db): Promise<string> {
  const own = await clipboardValue(db, "docledger_product_facts");
  const address = await clipboardValue(db, "business_address");
  return `Price and signature from the founder: ${own ?? "not pasted yet. Do not quote a price. Sign as: The Doc Ledger team."}${address ? `\nPostal address, the last line of the signature: ${address}` : ""}${await siteLine(db)}`;
}

async function docledgerFloorId(db: Db): Promise<string | null> {
  const [f] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "docledger")).limit(1);
  return f?.id ?? null;
}

async function recentReplies(db: Db, now: Date, days: number, limit: number): Promise<Array<{ company: string; text: string; segment: string | null }>> {
  const rows = await db
    .select({ company: leads.company, segment: leads.segment, text: outreach.replyText })
    .from(outreach)
    .innerJoin(leads, eq(leads.id, outreach.leadId))
    .where(and(eq(outreach.simulated, false), isNotNull(outreach.replyText), gte(outreach.replyAt, new Date(now.getTime() - days * DAY_MS))))
    .orderBy(desc(outreach.replyAt))
    .limit(limit);
  return rows.map((r) => ({ company: r.company, segment: r.segment, text: (r.text ?? "").replace(/\s+/g, " ").slice(0, 400) }));
}

async function ownerRejections(db: Db, limit: number): Promise<string[]> {
  const rows = await db
    .select({ summary: approvals.summary, feedback: approvals.feedback })
    .from(approvals)
    .where(and(eq(approvals.simulated, false), eq(approvals.status, "rejected"), isNotNull(approvals.feedback), sql`coalesce(${approvals.decidedVia}, '') <> 'owner'`))
    .orderBy(desc(approvals.decidedAt))
    .limit(limit);
  return rows.map((r) => `${r.summary}: ${r.feedback}`);
}

export async function currentRoadmap(db: Db): Promise<RoadmapItem[]> {
  const s = await getSettings(db);
  const r = s.docledger_roadmap as { items?: RoadmapItem[] } | null;
  return Array.isArray(r?.items) ? r!.items : [];
}

async function countBy(db: Db, column: typeof leads.status | typeof leads.country | typeof leads.segment, limit: number): Promise<string> {
  const rows = await db
    .select({ k: column, n: sql<string>`count(*)` })
    .from(leads)
    .where(eq(leads.simulated, false))
    .groupBy(column)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => `${r.k ?? "unknown"} ${r.n}`).join(", ") || "none yet";
}

const lower = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------------------------
// Head of Growth: every day, at most three ideas the owner approves with one tap. Approved ideas become experiments.
export const growthIdeas: Playbook = {
  kind: "growth_ideas",
  effort: RESEARCH_EFFORT,
  webSearchMaxUses: 3,
  maxTokens: 4000,
  system: `You are the Head of Growth at Doc Ledger, a young software company. The founder wants his first paying customers, then steady growth, and he reads your ideas on his phone. Every day you study the numbers, the replies and the market, and bring him at most three concrete ideas he can approve with one tap.
A good idea is specific, cheap, and shows a result within two or three weeks: a new kind of company or country to target, a sharper angle or subject line, a partner type, an offer (for example: we set up their first document type for them), a feature buyers ask for, a piece of content. Each idea names one owner on the team who carries it and gives that person clear instructions:
scout finds companies, analyst qualifies them, writer writes first emails, chaser handles replies and follow ups, partners finds firms that refer clients, product keeps the roadmap and tickets for the builder, marketer writes posts and web copy the founder publishes, success looks after companies in their free month.
Never propose buying lists, scraping personal data, mass messaging, fake reviews, or emailing countries on the skip list. Never repeat an idea that is running, waiting, or was turned down. Use at most three web searches, only for facts you need (a competitor's price, where finance teams in a region meet). If nothing is worth the founder's time today, return no ideas and say why in the note.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ideas", "note"],
    properties: {
      ideas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "why", "experiment", "metric", "owner", "instructions", "days"],
          properties: {
            title: { type: "string" },
            why: { type: "string" },
            experiment: { type: "string" },
            metric: { type: "string" },
            owner: { type: "string", enum: [...IDEA_OWNERS] },
            instructions: { type: "string" },
            days: { type: "integer" },
          },
        },
      },
      note: { type: "string" },
    },
  },
  async prepare(_task, ctx) {
    const pending = await pendingIdeaTitles(ctx.db);
    if (pending.length >= MAX_PENDING_IDEAS) return { skip: `${pending.length} ideas already wait for the founder` };
    const funnel = await salesFunnel(ctx.db, ctx.now);
    const experiments = await allExperiments(ctx.db);
    const running = experiments.filter((e) => Date.parse(e.endsAt) > ctx.now.getTime());
    const ended = experiments.filter((e) => Date.parse(e.endsAt) <= ctx.now.getTime()).slice(0, 5);
    const recent = await recentIdeaTitles(ctx.db, ctx.now);
    const replies = await recentReplies(ctx.db, ctx.now, 21, 8);
    const rejections = await ownerRejections(ctx.db, 5);
    const roadmap = (await currentRoadmap(ctx.db)).slice(0, 5);
    const skip = await skippedCountries(ctx.db);
    const lines = [
      `Today: ${ctx.now.toISOString().slice(0, 10)}`,
      `The product: ${DOCLEDGER.oneLine} ${DOCLEDGER.differentiator}`,
      `Who buys: ${DOCLEDGER.idealCustomer}`,
      `This week: ${funnel.leadsWeek} leads found, ${funnel.sentWeek} emails sent, ${funnel.repliesWeek} replies${funnel.replyRatePct !== null ? ` (${funnel.replyRatePct} percent)` : ""}, ${funnel.demosWeek} demos, ${funnel.hotOpen} hot replies waiting on the founder.`,
      `All leads by status: ${await countBy(ctx.db, leads.status, 10)}`,
      `Leads by country: ${await countBy(ctx.db, leads.country, 6)}`,
      `Leads by kind: ${await countBy(ctx.db, leads.segment, 6)}`,
      `Replies lately:\n${replies.map((r) => `- ${r.company}${r.segment?.startsWith("partner") ? " (partner)" : ""}: ${r.text}`).join("\n") || "- none yet"}`,
      `The founder turned these down, with his reason:\n${rejections.map((r) => `- ${r}`).join("\n") || "- nothing yet"}`,
      `Running experiments:\n${running.map((e) => `- ${e.title} (${OWNER_LABEL[e.owner]}, until ${e.endsAt.slice(0, 10)}, measured by ${e.metric})`).join("\n") || "- none"}`,
      `Ended experiments to learn from:\n${ended.map((e) => `- ${e.title} (${OWNER_LABEL[e.owner]}, measured by ${e.metric})`).join("\n") || "- none"}`,
      `Roadmap from Product:\n${roadmap.map((r) => `- ${r.title} (${r.priority})`).join("\n") || "- empty"}`,
      `Waiting for the founder or turned down in the last 30 days (never repeat these): ${[...pending, ...recent].join("; ") || "none"}`,
      `Countries on the skip list: ${Object.keys(skip).join(", ") || "none"}`,
    ];
    return { user: `${lines.join("\n\n")}\n\nBring today's ideas and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const raw = Array.isArray(output.ideas) ? output.ideas : [];
    const seen = new Set([...(await pendingIdeaTitles(ctx.db)), ...(await recentIdeaTitles(ctx.db, ctx.now))].map(lower));
    let raised = 0;
    for (const r of raw.slice(0, MAX_PENDING_IDEAS)) {
      const o = (r ?? {}) as Record<string, unknown>;
      if (!isIdeaOwner(o.owner)) continue;
      const idea: GrowthIdea = {
        title: plainDashes(str(o.title, 90)),
        why: plainDashes(str(o.why, 500)),
        experiment: plainDashes(str(o.experiment, 500)),
        metric: plainDashes(str(o.metric, 160)),
        owner: o.owner,
        instructions: plainDashes(str(o.instructions, 800)),
        days: Math.min(21, Math.max(7, Math.round(num(o.days, 14)))),
      };
      if (!idea.title || !idea.instructions || seen.has(lower(idea.title))) continue;
      seen.add(lower(idea.title));
      await raiseApproval(
        ctx.db,
        {
          type: "decision",
          summary: `Idea: ${idea.title}`,
          content: { growthIdea: idea, text: `${idea.why}\nThe test: ${idea.experiment}\nWe measure: ${idea.metric}\nCarried by ${OWNER_LABEL[idea.owner]} for ${idea.days} days.` },
          riskNote: `Approve to hand it to ${OWNER_LABEL[idea.owner]} for ${idea.days} days. Anything it sends still comes to you first. Reject with a line to steer the next ideas.`,
          agentId: ctx.agentId,
          floorId: ctx.floorId,
        },
        ctx.now,
      );
      raised += 1;
    }
    await logEvent(ctx.db, { taskId: task.id, agentId: ctx.agentId, floorId: ctx.floorId, type: "log", message: raised ? `Brought ${raised} idea${raised === 1 ? "" : "s"} to the founder` : `No new ideas today: ${str(output.note, 160)}`, at: ctx.now });
    return { summary: raised ? `Brought ${raised} idea${raised === 1 ? "" : "s"} to the founder` : "No idea worth his time today", extra: { raised, note: str(output.note, 600) } };
  },
};

export async function pendingIdeaTitles(db: Db): Promise<string[]> {
  const rows = await db
    .select({ content: approvals.content })
    .from(approvals)
    .where(and(eq(approvals.type, "decision"), eq(approvals.status, "pending"), eq(approvals.simulated, false), sql`(${approvals.content} -> 'growthIdea') is not null`));
  return rows.map((r) => str(((r.content as Record<string, unknown>).growthIdea as Record<string, unknown> | undefined)?.title, 90)).filter(Boolean);
}

async function recentIdeaTitles(db: Db, now: Date): Promise<string[]> {
  const rows = await db
    .select({ content: approvals.content, status: approvals.status, feedback: approvals.feedback })
    .from(approvals)
    .where(and(eq(approvals.type, "decision"), eq(approvals.simulated, false), inArray(approvals.status, ["approved", "rejected"]), sql`(${approvals.content} -> 'growthIdea') is not null`, gte(approvals.createdAt, new Date(now.getTime() - 30 * DAY_MS))));
  return rows.map((r) => {
    const title = str(((r.content as Record<string, unknown>).growthIdea as Record<string, unknown> | undefined)?.title, 90);
    return r.status === "rejected" && r.feedback ? `${title} (turned down: ${r.feedback})` : title;
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------
// Partners: firms that already serve DocLedger's buyers and could refer them. Each one gets an email on the phone.
const PARTNER_KINDS = ["accounting_firm", "association", "software_reseller", "software_vendor", "consultant", "other"] as const;

function partnerKey(company: string, website: string): string {
  let domain = "";
  try {
    domain = website ? new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "") : "";
  } catch {
    domain = "";
  }
  return `partner|${domain || company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export const findPartners: Playbook = {
  kind: "find_partners",
  effort: RESEARCH_EFFORT,
  webSearchMaxUses: 5,
  webFetchMaxUses: 4,
  maxTokens: 5000,
  system: `You are Partners at Doc Ledger. Find organisations that already serve the finance teams Doc Ledger sells to and could refer them as clients: bookkeeping and accounting firms that work for logistics, freight or trading companies; freight forwarder associations and chambers of commerce; resellers and consultants for accounting software such as Zoho Books, QuickBooks, Xero, Tally or Odoo; vendors of logistics software without their own receipt capture.
${docledgerKnowledge()}
The partner offer: ${PARTNER_OFFER}
For each organisation: its real name and website as you saw them on a page, the page you saw it on, a public work email (a general address such as info@ is fine, never guess one), a named contact only if a page shows it, and one short email from the founder: who we are in two sentences, why their clients would care, the partner offer without numbers, and one ask: a fifteen minute call. No price. End with one line: reply stop and we will not write again. Sign with the founder's signature.
Return up to three organisations, best first. Returning fewer with an honest note is fine.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["partners", "note"],
    properties: {
      partners: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["company", "kind", "website", "country", "city", "contactName", "email", "why", "sourceUrl", "subject", "body"],
          properties: {
            company: { type: "string" },
            kind: { type: "string", enum: [...PARTNER_KINDS] },
            website: { type: "string" },
            country: { type: "string" },
            city: { type: "string" },
            contactName: { type: "string" },
            email: { type: "string" },
            why: { type: "string" },
            sourceUrl: { type: "string" },
            subject: { type: "string" },
            body: { type: "string" },
          },
        },
      },
      note: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const skip = await skippedCountries(ctx.db);
    const known = await ctx.db.select({ company: leads.company }).from(leads).where(and(eq(leads.simulated, false), sql`coalesce(${leads.segment}, '') like 'partner%'`)).limit(80);
    const calendar = await clipboardValue(ctx.db, "calendar_link");
    const focus = str(input(task).instructions, 600);
    return {
      user: `${await ownerFacts(ctx.db)}\nCalendar link for the call: ${calendar ?? "not pasted, ask for two times instead"}\n\n${focus ? `Focus from the Head of Growth: ${focus}\n` : ""}${await experimentLines(ctx.db, ctx.now, "partners")}Region today: ${regionFor(ctx.now)}\nSkip these countries: ${Object.keys(skip).join(", ") || "none"}\nAlready contacted (skip): ${known.map((k) => k.company).join("; ") || "nobody yet"}\n\nSearch the web before you answer. Find partners and return the JSON object.`,
    };
  },
  async absorb(task, output, ctx) {
    const rows = Array.isArray(output.partners) ? output.partners : [];
    const skip = await skippedCountries(ctx.db);
    const salesFloor = await docledgerFloorId(ctx.db);
    let added = 0;
    const skipped: string[] = [];
    for (const raw of rows.slice(0, 3)) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const company = str(r.company, 120);
      const email = str(r.email, 200).toLowerCase();
      const sourceUrl = str(r.sourceUrl, 400);
      const country = normaliseCountry(str(r.country, 60)) || "AE";
      if (!company || !EMAIL_RE.test(email) || !/^https?:\/\//.test(sourceUrl)) {
        skipped.push(`${company || "unnamed"}: no email or source`);
        continue;
      }
      if (skip[country]) {
        skipped.push(`${company}: ${country} is on the skip list`);
        continue;
      }
      const website = str(r.website, 300);
      const dedupeKey = partnerKey(company, website);
      const [exists] = await ctx.db.select({ id: leads.id }).from(leads).where(eq(leads.dedupeKey, dedupeKey)).limit(1);
      if (exists) continue;
      const kind = (PARTNER_KINDS as readonly string[]).includes(str(r.kind)) ? str(r.kind) : "other";
      const contactName = str(r.contactName, 120);
      const subject = plainDashes(str(r.subject, 120)) || "Your clients' receipts";
      const body = plainDashes(str(r.body, 3000));
      if (!body) continue;
      const [lead] = await ctx.db
        .insert(leads)
        .values({ floorId: salesFloor, company, website: website || null, segment: `partner_${kind}`, city: str(r.city, 80) || null, country, sourceUrl, decisionMaker: { name: contactName, title: "", email, research: [plainDashes(str(r.why, 400))], angle: "referral partner" }, score: null, scoreReason: plainDashes(str(r.why, 400)), status: "drafted", dedupeKey, foundByTaskId: task.id, simulated: false, createdAt: ctx.now, updatedAt: ctx.now })
        .returning({ id: leads.id });
      if (!lead) continue;
      const [row] = await ctx.db.insert(outreach).values({ leadId: lead.id, step: 1, channel: "email", subject, bodyText: body, status: "draft", simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: outreach.id });
      // Partner emails always go through the owner: they ask for his time and speak for the company's terms.
      const { id: approvalId } = await raiseApproval(
        ctx.db,
        { type: "outreach_email", summary: `Send partner email to ${company}`, content: { to: email, toName: contactName, company, subject, body, outreachId: row?.id ?? null, partner: true, kind }, riskNote: "Partner email: asks for a fifteen minute call about referring clients. No price and no numbers on the share.", previewUrl: sourceUrl, taskId: task.id, agentId: ctx.agentId, floorId: salesFloor },
        ctx.now,
      );
      if (row) await ctx.db.update(outreach).set({ approvalId }).where(eq(outreach.id, row.id));
      added += 1;
    }
    const summary = added ? `Found ${added} partner${added === 1 ? "" : "s"}, emails on the phone` : "No partner found today";
    return { summary, extra: { added, skipped, note: str(output.note, 600) } };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Product: listens to the market and keeps the roadmap. A clear, small item becomes a Builder ticket on approval.
export const productReview: Playbook = {
  kind: "product_review",
  effort: RESEARCH_EFFORT,
  webSearchMaxUses: 2,
  maxTokens: 4000,
  system: `You are the Product Manager at Doc Ledger. You listen to the market: every reply from a prospect, every reason a company did not fit, every note the founder wrote when he turned a draft down. You keep a short roadmap, at most eight items, ranked by what would make more companies say yes: now, next, later. Each item says why and quotes the evidence (who said what). When one item is clear, small and worth building now, write one ticket for Builder, who opens a pull request on the Doc Ledger code for the founder to review: a title, what to change, and how to tell it works. Otherwise leave the ticket title empty.
${docledgerKnowledge()}
You may run two web searches to see how competitors handle the same need. Never invent customer quotes.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["roadmap", "ticket", "note"],
    properties: {
      roadmap: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "why", "evidence", "priority"],
          properties: { title: { type: "string" }, why: { type: "string" }, evidence: { type: "string" }, priority: { type: "string", enum: ["now", "next", "later"] } },
        },
      },
      ticket: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "acceptance"],
        properties: { title: { type: "string" }, description: { type: "string" }, acceptance: { type: "string" } },
      },
      note: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const [last] = await ctx.db
      .select({ at: tasks.finishedAt })
      .from(tasks)
      .where(and(eq(tasks.kind, "product_review"), eq(tasks.simulated, false), inArray(tasks.status, ["review", "done"]), sql`${tasks.id} <> ${task.id}`))
      .orderBy(desc(tasks.finishedAt))
      .limit(1);
    const since = last?.at ?? new Date(0);
    const replies = await recentReplies(ctx.db, ctx.now, 30, 12);
    const [freshReply] = await ctx.db.select({ id: outreach.id }).from(outreach).where(and(eq(outreach.simulated, false), gte(outreach.replyAt, since))).limit(1);
    const focus = str(input(task).instructions, 600);
    if (!freshReply && !focus && ctx.now.getTime() - since.getTime() < 3 * DAY_MS) return { skip: "Nothing new from the market since the last review" };
    const misfits = await ctx.db.select({ company: leads.company, reason: leads.scoreReason }).from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "disqualified"))).orderBy(desc(leads.updatedAt)).limit(8);
    const rejections = await ownerRejections(ctx.db, 8);
    const roadmap = await currentRoadmap(ctx.db);
    const open = await ctx.db.select({ title: tickets.title, status: tickets.status }).from(tickets).where(and(eq(tickets.simulated, false), inArray(tickets.status, ["proposed", "backlog", "building", "pr_open"]))).limit(10);
    return {
      user: `${focus ? `Focus from the Head of Growth: ${focus}\n` : ""}${await experimentLines(ctx.db, ctx.now, "product")}Replies from the market:\n${replies.map((r) => `- ${r.company}: ${r.text}`).join("\n") || "- none yet"}\n\nCompanies that did not fit, and why:\n${misfits.map((m) => `- ${m.company}: ${m.reason ?? "no reason"}`).join("\n") || "- none"}\n\nThe founder's notes on drafts he turned down:\n${rejections.map((r) => `- ${r}`).join("\n") || "- none"}\n\nCurrent roadmap:\n${roadmap.map((r) => `- ${r.title} (${r.priority}): ${r.why}`).join("\n") || "- empty"}\n\nTickets already open (do not repeat): ${open.map((t) => `${t.title} (${t.status})`).join("; ") || "none"}\n\nUpdate the roadmap and return the JSON object.`,
    };
  },
  async absorb(task, output, ctx) {
    const items: RoadmapItem[] = (Array.isArray(output.roadmap) ? output.roadmap : [])
      .map((raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const priority = (["now", "next", "later"] as const).find((p) => p === r.priority) ?? "later";
        return { title: plainDashes(str(r.title, 100)), why: plainDashes(str(r.why, 300)), evidence: plainDashes(str(r.evidence, 300)), priority };
      })
      .filter((r) => r.title)
      .slice(0, 8);
    if (items.length) await setSetting(ctx.db, "docledger_roadmap", { items, updatedAt: ctx.now.toISOString() });
    const t = (output.ticket ?? {}) as Record<string, unknown>;
    const title = plainDashes(str(t.title, 100));
    let ticketId: string | null = null;
    if (title) {
      const [dupe] = await ctx.db.select({ id: tickets.id }).from(tickets).where(and(eq(tickets.simulated, false), sql`lower(${tickets.title}) = ${title.toLowerCase()}`)).limit(1);
      if (!dupe) {
        const salesFloor = await docledgerFloorId(ctx.db);
        const description = `${plainDashes(str(t.description, 2000))}\n\nHow to tell it works: ${plainDashes(str(t.acceptance, 800))}`;
        const repo = await clipboardValue(ctx.db, "docledger_repo_url");
        const [row] = await ctx.db.insert(tickets).values({ floorId: salesFloor, source: "product", title, description, repo: repo ?? null, status: "proposed", simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: tickets.id });
        ticketId = row?.id ?? null;
        if (ticketId) {
          const { id: approvalId } = await raiseApproval(
            ctx.db,
            { type: "decision", summary: `Build: ${title}`, content: { ticketId, text: description }, riskNote: "Approve to put it in Builder's queue for tonight. Builder opens a pull request on the DocLedger repo and never merges it: you review and merge.", agentId: ctx.agentId, floorId: ctx.floorId },
            ctx.now,
          );
          await ctx.db.update(tickets).set({ approvalId }).where(eq(tickets.id, ticketId));
        }
      }
    }
    return { summary: `Roadmap updated (${items.length} items)${ticketId ? ", one ticket on the phone" : ""}`, extra: { items: items.length, ticketId, note: str(output.note, 600) } };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Marketer: every week, what the founder posts himself (bots may not post on LinkedIn) and the words for a web page.
export const marketingPack: Playbook = {
  kind: "marketing_pack",
  webSearchMaxUses: 0,
  maxTokens: 3500,
  system: `You are the Marketer at Doc Ledger. Every week you prepare what the founder publishes himself: two LinkedIn posts in his voice as the founder of a young company (one story about the problem, one about something the team learned this week, no hashtags wall, one question at the end), one listing for software directories (a tagline, a description of about eighty words, three categories), and the words for a simple Doc Ledger web page (a headline, a subheadline, three points, one call to action). Use real facts from the product and the week; never name a prospect or quote them by name.
${docledgerKnowledge()}
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["linkedin", "listing", "page", "note"],
    properties: {
      linkedin: { type: "array", items: { type: "object", additionalProperties: false, required: ["hook", "body"], properties: { hook: { type: "string" }, body: { type: "string" } } } },
      listing: { type: "object", additionalProperties: false, required: ["tagline", "description", "categories"], properties: { tagline: { type: "string" }, description: { type: "string" }, categories: { type: "array", items: { type: "string" } } } },
      page: { type: "object", additionalProperties: false, required: ["headline", "subheadline", "points", "cta"], properties: { headline: { type: "string" }, subheadline: { type: "string" }, points: { type: "array", items: { type: "string" } }, cta: { type: "string" } } },
      note: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const funnel = await salesFunnel(ctx.db, ctx.now);
    const roadmap = (await currentRoadmap(ctx.db)).slice(0, 4);
    const replies = await recentReplies(ctx.db, ctx.now, 14, 6);
    const focus = str(input(task).instructions, 600);
    return {
      user: `${focus ? `Focus from the Head of Growth: ${focus}\n` : ""}${await experimentLines(ctx.db, ctx.now, "marketer")}This week: ${funnel.sentWeek} emails sent, ${funnel.repliesWeek} replies, ${funnel.demosWeek} demos.\nWhat the market said (anonymise, never name them):\n${replies.map((r) => `- ${r.text}`).join("\n") || "- nothing yet"}\nWhat Product is working on: ${roadmap.map((r) => r.title).join("; ") || "nothing listed"}\n\nWrite this week's material and return the JSON object.`,
    };
  },
  async absorb(_task, output, ctx) {
    const linkedin = (Array.isArray(output.linkedin) ? output.linkedin : []).slice(0, 2).map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      return { hook: plainDashes(str(r.hook, 200)), body: plainDashes(str(r.body, 2500)) };
    }).filter((p) => p.body);
    const l = (output.listing ?? {}) as Record<string, unknown>;
    const pg = (output.page ?? {}) as Record<string, unknown>;
    const pack: MarketingPack = {
      at: ctx.now.toISOString(),
      linkedin,
      listing: { tagline: plainDashes(str(l.tagline, 120)), description: plainDashes(str(l.description, 900)), categories: (Array.isArray(l.categories) ? l.categories : []).map((c) => plainDashes(str(c, 40))).filter(Boolean).slice(0, 3) },
      page: { headline: plainDashes(str(pg.headline, 120)), subheadline: plainDashes(str(pg.subheadline, 240)), points: (Array.isArray(pg.points) ? pg.points : []).map((p) => plainDashes(str(p, 200))).filter(Boolean).slice(0, 3), cta: plainDashes(str(pg.cta, 60)) },
    };
    await setSetting(ctx.db, "docledger_marketing", pack);
    if (linkedin[0]) {
      await enqueueMessage(ctx.db, { kind: "marketing", body: `Marketer: this week's LinkedIn post, ready for you to post:\n\n${linkedin[0].hook}\n\n${linkedin[0].body}\n\nA second post, a directory listing and web page words are in the game: Warden, Company tab.`, now: ctx.now });
    }
    return { summary: `Wrote ${linkedin.length} LinkedIn post${linkedin.length === 1 ? "" : "s"}, a listing and page copy`, extra: { posts: linkedin.length } };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Success: a company in its free month gets a welcome, check ins on days 3, 7 and 21, and the paid offer on day 27.
export const successEmail: Playbook = {
  kind: "success_email",
  webSearchMaxUses: 0,
  maxTokens: 1500,
  system: `You are Customer Success at Doc Ledger. A company started its free first month. Your emails help them get value fast and stay: the welcome gives the first three things to do (photograph ten real bills, check the fields, add their own document type if ours do not fit) and says who to write to; the day 3 check in asks whether the first bill read right and offers a short call; the day 10 check in uses the usage numbers you are given (documents read, members, last activity): praise what they did, or ask what got in the way if they did little, one question only; the paid offer on day 25 thanks them, names what they did in the month from the numbers, and asks them to continue at the founder's price (set per company, the base from his facts) by adding a card on the Billing page of the app (the link you are given), with the calendar link for questions. Never invent usage: when the numbers are missing, do not mention them. Short, warm, plain. Sign with the founder's signature.
${docledgerKnowledge()}
${STYLE}`,
  schema: { type: "object", additionalProperties: false, required: ["subject", "body"], properties: { subject: { type: "string" }, body: { type: "string" } } },
  async prepare(task, ctx) {
    const i = input(task);
    const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, str(i.leadId))).limit(1);
    if (!lead || lead.status !== "trial") return { skip: "The company is not in a free month any more" };
    const step = SUCCESS_STEPS.find((s) => s.key === i.step);
    if (!step) return { skip: "Unknown success step" };
    const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
    const calendar = await clipboardValue(ctx.db, "calendar_link");
    const thread = await ctx.db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(desc(outreach.step)).limit(4);
    // D080: the app's numbers for this company, when it signed up through its sales code
    const usage = lead.previewCode ? (await appUsageByCode(ctx.db, [lead.previewCode])).get(lead.previewCode) : undefined;
    const billingUrl = `${await appBaseUrl(ctx.db)}/billing`;
    return {
      user: `${await ownerFacts(ctx.db)}\nCalendar link: ${calendar ?? "not pasted"}\nBilling page in the app (where they add a card): ${billingUrl}\n${await experimentLines(ctx.db, ctx.now, "success")}Company: ${lead.company} (${lead.country}), contact ${str(dm.name) || "unknown"}\nFree month started: ${str(dm.trialStart).slice(0, 10) || "recently"}\nWhat they did in the app: ${usageLine(usage, ctx.now)}\nThis email: ${step.label}\nLast messages in the thread:\n${thread.reverse().map((o) => `${o.status === "replied" ? "They wrote" : "We wrote"}: ${(o.replyText ?? o.bodyText ?? "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n") || "none"}\n\nWrite the email and return the JSON object.`,
    };
  },
  async absorb(task, output, ctx) {
    const i = input(task);
    const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, str(i.leadId))).limit(1);
    const step = SUCCESS_STEPS.find((s) => s.key === i.step);
    if (!lead || !step) return { summary: "The company vanished" };
    const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
    const to = str(dm.email).toLowerCase();
    const subject = plainDashes(str(output.subject, 120)) || `Your first month with Doc Ledger`;
    const body = plainDashes(str(output.body, 3000));
    const done = Array.isArray(dm.successSteps) ? (dm.successSteps as string[]) : [];
    await ctx.db.update(leads).set({ decisionMaker: { ...dm, successSteps: [...new Set([...done, step.key])] }, updatedAt: ctx.now }).where(eq(leads.id, lead.id));
    if (!EMAIL_RE.test(to) || !body) return { summary: `${step.label} for ${lead.company}: no email address, nothing drafted` };
    const [last] = await ctx.db.select({ step: outreach.step }).from(outreach).where(eq(outreach.leadId, lead.id)).orderBy(desc(outreach.step)).limit(1);
    const [row] = await ctx.db.insert(outreach).values({ leadId: lead.id, step: (last?.step ?? 0) + 1, channel: "email", subject, bodyText: body, status: "draft", simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: outreach.id });
    const { id: approvalId } = await raiseApproval(
      ctx.db,
      { type: "outreach_email", summary: `${step.label} for ${lead.company}`, content: { to, toName: str(dm.name), company: lead.company, subject, body, outreachId: row?.id ?? null, success: step.key }, riskNote: step.key === "offer" ? "The paid offer: check the price before you approve." : "A customer in the free month: a short, helpful email.", taskId: task.id, agentId: ctx.agentId, floorId: lead.floorId },
      ctx.now,
    );
    if (row) await ctx.db.update(outreach).set({ approvalId }).where(eq(outreach.id, row.id));
    return { summary: `${step.label} for ${lead.company} on the phone` };
  },
};

export const GROWTH_PLAYBOOKS: Record<string, Playbook> = {
  growth_ideas: growthIdeas,
  find_partners: findPartners,
  product_review: productReview,
  marketing_pack: marketingPack,
  success_email: successEmail,
};
