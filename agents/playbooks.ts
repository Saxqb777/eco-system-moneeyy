// Worker playbooks for the live floors. Each one prepares the request from the database and absorbs the
// structured answer back into rows. Every playbook forbids hyphens and em dashes in its output (rule 7).
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leads, outreach, taskEvents, tasks } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { clipboardValue } from "@/lib/clipboard";
import { DEALS_PLAYBOOKS } from "./deals-playbooks";

type TaskRow = typeof tasks.$inferSelect;
type LeadRow = typeof leads.$inferSelect;

export interface PlaybookContext {
  db: Db;
  now: Date;
  floorId: string | null;
  agentId: string | null;
  agentName: string;
}

export interface Prepared {
  user: string;
  webSearchMaxUses?: number;
  webFetchMaxUses?: number;
}

export interface Absorbed {
  summary: string;
  extra?: Record<string, unknown>;
}

export interface Playbook {
  kind: string;
  system: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  webSearchMaxUses: number;
  webFetchMaxUses?: number;
  prepare(task: TaskRow, ctx: PlaybookContext): Promise<Prepared | { skip: string }>;
  absorb(task: TaskRow, output: Record<string, unknown>, ctx: PlaybookContext): Promise<Absorbed>;
}

const STYLE = "Write plain English in short sentences. Never use hyphens or em dashes in any text you produce, use commas or colons instead. Never invent facts: only report what you saw on a page or in the input.";

export { STYLE, logEvent, str, num, input };

export function dedupeKeyFor(company: string, website: string | null | undefined): string {
  const name = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let domain = "";
  try {
    if (website) domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    domain = "";
  }
  return domain ? `${name}|${domain}` : name;
}

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const input = (t: TaskRow) => (t.input ?? {}) as Record<string, unknown>;

async function facts(db: Db): Promise<string> {
  return (await clipboardValue(db, "docledger_product_facts")) ?? "DocLedger: one ledger for every shipping document a freight forwarder handles, so the team sees what is missing before customs asks. Pricing and signature not pasted yet.";
}

// Scout: real UAE companies, never invented.
const findLeads: Playbook = {
  kind: "find_leads",
  webSearchMaxUses: 5,
  maxTokens: 2500,
  system: `You are Scout on the DocLedger Sales floor of The Tower. DocLedger is a document ledger for freight forwarders. Your job: find real companies in the UAE that would buy it: freight forwarders first, then customs brokers and small third party logistics firms (3PL).
Use web search, at most a few queries, and read what the results say. Return up to 12 companies you actually saw named on a page, each with the page you saw it on. Skip anything in the exclusion list. Prefer small and medium firms in Dubai, Jebel Ali, Sharjah and Abu Dhabi, not the global giants.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["leads", "note"],
    properties: {
      leads: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["company", "website", "segment", "city", "sourceUrl", "phone", "why"],
          properties: {
            company: { type: "string" },
            website: { type: "string", description: "root URL or empty" },
            segment: { type: "string", enum: ["freight_forwarder", "customs_broker", "small_3pl"] },
            city: { type: "string" },
            sourceUrl: { type: "string", description: "the page where you saw the company" },
            phone: { type: "string", description: "public phone number or empty" },
            why: { type: "string", description: "one line on the fit" },
          },
        },
      },
      note: { type: "string", description: "one line for Warden on how the search went" },
    },
  },
  async prepare(task, ctx) {
    const recent = await ctx.db.select({ company: leads.company }).from(leads).where(eq(leads.simulated, false)).orderBy(desc(leads.createdAt)).limit(200);
    const exclude = recent.map((r) => r.company).join("; ") || "none yet";
    const focus = str(input(task).instructions) || "Freight forwarders around Jebel Ali and Dubai first.";
    return { user: `Focus from Warden: ${focus}\nToday: ${ctx.now.toISOString().slice(0, 10)}\nExclusion list (already known): ${exclude}\n\nFind the leads and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const rows = Array.isArray(output.leads) ? output.leads : [];
    let inserted = 0;
    let dupes = 0;
    for (const raw of rows) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const company = str(r.company, 120);
      if (!company) continue;
      const website = str(r.website, 200) || null;
      const key = dedupeKeyFor(company, website);
      const [ins] = await ctx.db
        .insert(leads)
        .values({ floorId: ctx.floorId, company, website, segment: str(r.segment, 40) || "freight_forwarder", city: str(r.city, 60) || null, phone: str(r.phone, 40) || null, sourceUrl: str(r.sourceUrl, 300) || null, scoreReason: str(r.why, 300) || null, status: "new", dedupeKey: key, foundByTaskId: task.id, simulated: false, createdAt: ctx.now, updatedAt: ctx.now })
        .onConflictDoNothing()
        .returning({ id: leads.id });
      if (ins) inserted += 1;
      else dupes += 1;
    }
    return { summary: `Found ${inserted} new lead${inserted === 1 ? "" : "s"}${dupes ? `, ${dupes} already known` : ""}`, extra: { found: inserted, duplicates: dupes, note: str(output.note, 300) } };
  },
};

// Analyst: score the fit, find the decision maker.
const qualifyLead: Playbook = {
  kind: "qualify_lead",
  webSearchMaxUses: 3,
  maxTokens: 1500,
  system: `You are Analyst on the DocLedger Sales floor of The Tower. For one company, judge how well DocLedger fits (1 to 10) and find the person who would buy it: operations manager, managing director, head of documentation or similar. Look for a public work email on the company site or a public directory. If you cannot find an email, leave it empty and say so, never guess one.
A score of 6 or more means qualified. Small and medium freight forwarders with customs paperwork score high. Couriers, airlines and shipping lines score low.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["score", "reason", "qualified", "decisionMaker", "notes"],
    properties: {
      score: { type: "integer", minimum: 1, maximum: 10 },
      reason: { type: "string" },
      qualified: { type: "boolean" },
      decisionMaker: {
        type: "object",
        additionalProperties: false,
        required: ["name", "title", "email", "linkedin", "confidence"],
        properties: { name: { type: "string" }, title: { type: "string" }, email: { type: "string" }, linkedin: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 } },
      },
      notes: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const leadId = str(input(task).leadId);
    const [lead] = leadId ? await ctx.db.select().from(leads).where(eq(leads.id, leadId)).limit(1) : [];
    if (!lead) return { skip: "No lead attached to this task" };
    if (lead.status !== "new") return { skip: `Lead ${lead.company} is already ${lead.status}` };
    const f = await facts(ctx.db);
    return { user: `Product facts:\n${f}\n\nCompany: ${lead.company}\nWebsite: ${lead.website ?? "unknown"}\nSegment: ${lead.segment ?? "unknown"}\nCity: ${lead.city ?? "unknown"}\nSeen at: ${lead.sourceUrl ?? "unknown"}\nScout's note: ${lead.scoreReason ?? ""}\n\nQualify this company and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const leadId = str(input(task).leadId);
    const dmRaw = (output.decisionMaker ?? {}) as Record<string, unknown>;
    const email = str(dmRaw.email, 120).toLowerCase();
    const dm = { name: str(dmRaw.name, 80), title: str(dmRaw.title, 80), email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "", linkedin: str(dmRaw.linkedin, 200), confidence: num(dmRaw.confidence, 0) };
    const score = Math.min(10, Math.max(1, Math.round(num(output.score, 1))));
    const qualified = output.qualified === true && score >= 6;
    const status = !qualified ? "disqualified" : dm.email ? "qualified" : "no_contact";
    await ctx.db.update(leads).set({ score, scoreReason: str(output.reason, 400) || null, decisionMaker: dm, status, updatedAt: ctx.now }).where(eq(leads.id, leadId));
    const [lead] = await ctx.db.select({ company: leads.company }).from(leads).where(eq(leads.id, leadId)).limit(1);
    const company = lead?.company ?? "the lead";
    return { summary: `Scored ${company}: ${score}/10, ${status === "qualified" ? `${dm.name || "decision maker"} found` : status === "no_contact" ? "qualified but no public email" : "not a fit"}`, extra: { company, score, qualified, status } };
  },
};

// Writer: one personalised email, never sent by itself.
const draftOutreach: Playbook = {
  kind: "draft_outreach",
  webSearchMaxUses: 0,
  maxTokens: 1200,
  system: `You are Writer on the DocLedger Sales floor of The Tower. Write one short first email to the decision maker at a qualified freight forwarder. Under 120 words. Open with something specific to their company, name the one problem DocLedger removes (chasing shipping documents before customs), offer a 15 minute demo, end with the owner's signature block from the facts and one plain opt out line ("Reply stop and I will not write again"). Subject under 8 words, no clickbait. No bullet lists, no emojis, no exclamation marks.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body", "personalisation"],
    properties: { subject: { type: "string" }, body: { type: "string" }, personalisation: { type: "string", description: "the specific detail you used" } },
  },
  async prepare(task, ctx) {
    const leadId = str(input(task).leadId);
    const [lead] = leadId ? await ctx.db.select().from(leads).where(eq(leads.id, leadId)).limit(1) : [];
    if (!lead) return { skip: "No lead attached to this task" };
    const dm = (lead.decisionMaker ?? {}) as Record<string, string>;
    if (!dm.email) return { skip: `${lead.company} has no public email yet` };
    const feedback = str(input(task).feedback);
    const f = await facts(ctx.db);
    return { user: `Product facts and signature:\n${f}\n\nCompany: ${lead.company} (${lead.segment ?? "freight forwarder"}, ${lead.city ?? "UAE"})\nWebsite: ${lead.website ?? "unknown"}\nWhy they fit: ${lead.scoreReason ?? ""}\nDecision maker: ${dm.name || "unknown"}, ${dm.title || "unknown title"}\n${feedback ? `Warden's feedback on the last draft: ${feedback}\n` : ""}\nWrite the email and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const leadId = str(input(task).leadId);
    const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return { summary: "Lead vanished before the draft landed" };
    const dm = (lead.decisionMaker ?? {}) as Record<string, string>;
    const subject = str(output.subject, 120) || `DocLedger for ${lead.company}`;
    const body = str(output.body, 4000);
    const [row] = await ctx.db.insert(outreach).values({ leadId: lead.id, step: 1, channel: "email", subject, bodyText: body, status: "draft", simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: outreach.id });
    const { id: approvalId } = await raiseApproval(ctx.db, {
      type: "outreach_email",
      summary: `Send first outreach email to ${dm.name || "the decision maker"} at ${lead.company}`,
      content: { to: dm.email, toName: dm.name, company: lead.company, subject, body, outreachId: row?.id ?? null },
      riskNote: "Cold email to a business address. One plain opt out line included.",
      taskId: task.id,
      agentId: ctx.agentId,
      floorId: ctx.floorId,
    }, ctx.now);
    if (row) await ctx.db.update(outreach).set({ approvalId, updatedAt: ctx.now }).where(eq(outreach.id, row.id));
    await ctx.db.update(leads).set({ status: "drafted", updatedAt: ctx.now }).where(eq(leads.id, lead.id));
    return { summary: `Outreach drafted for ${lead.company}, waiting for approval`, extra: { company: lead.company, subject, personalisation: str(output.personalisation, 200) } };
  },
};

// Chaser: follow ups and replies, demo booking with the calendar link.
const followUp: Playbook = {
  kind: "follow_up",
  webSearchMaxUses: 0,
  maxTokens: 1200,
  system: `You are Chaser on the DocLedger Sales floor of The Tower. You handle the thread after the first email. Read the thread and the reply if there is one, then choose:
- follow_up: no reply yet, write a short nudge with one new angle (never repeat the first email).
- propose_times: they are interested, offer the calendar link to pick a 15 minute slot.
- book_confirm: they picked or confirmed a time, confirm it warmly and say what to expect.
- close: they said no or stop. Write nothing to send, just note it.
Emails under 90 words, no bullet lists, no emojis. Include the opt out line only in follow_up.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["action", "subject", "body", "demoBooked", "note"],
    properties: {
      action: { type: "string", enum: ["follow_up", "propose_times", "book_confirm", "close"] },
      subject: { type: "string" },
      body: { type: "string" },
      demoBooked: { type: "boolean" },
      note: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const outreachId = str(input(task).outreachId);
    const [o] = outreachId ? await ctx.db.select().from(outreach).where(eq(outreach.id, outreachId)).limit(1) : [];
    if (!o || !o.leadId) return { skip: "No thread attached to this task" };
    const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, o.leadId)).limit(1);
    if (!lead) return { skip: "Lead vanished" };
    if (lead.status === "lost" || lead.status === "client") return { skip: `${lead.company} is ${lead.status}` };
    const thread = await ctx.db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(outreach.step);
    const calendar = (await clipboardValue(ctx.db, "calendar_link")) ?? "";
    const f = await facts(ctx.db);
    const lines = thread.map((t) => `Step ${t.step} (${t.status}${t.sentAt ? `, sent ${t.sentAt.toISOString().slice(0, 10)}` : ""}):\nSubject: ${t.subject ?? ""}\n${t.bodyText ?? ""}${t.replyText ? `\n\nTheir reply (${t.replyAt?.toISOString().slice(0, 10) ?? ""}):\n${t.replyText}` : ""}`);
    const mode = o.replyText ? "They replied. Handle the reply." : `No reply after step ${o.step}. Write follow up step ${o.step + 1}.`;
    return { user: `Product facts and signature:\n${f}\n\nCalendar link: ${calendar || "not pasted yet, ask them for two times instead"}\nCompany: ${lead.company}, contact ${(lead.decisionMaker as Record<string, string> | null)?.name ?? "unknown"}\nToday: ${ctx.now.toISOString().slice(0, 10)}\n\nThread:\n${lines.join("\n\n")}\n\n${mode}\nReturn the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const outreachId = str(input(task).outreachId);
    const [o] = await ctx.db.select().from(outreach).where(eq(outreach.id, outreachId)).limit(1);
    if (!o || !o.leadId) return { summary: "Thread vanished" };
    const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, o.leadId)).limit(1);
    if (!lead) return { summary: "Lead vanished" };
    const action = str(output.action, 20) || "follow_up";
    const dm = (lead.decisionMaker ?? {}) as Record<string, string>;
    if (o.status === "handling") await ctx.db.update(outreach).set({ status: "replied", updatedAt: ctx.now }).where(eq(outreach.id, o.id));
    if (action === "close") {
      await ctx.db.update(leads).set({ status: "lost", updatedAt: ctx.now }).where(eq(leads.id, lead.id));
      return { summary: `${lead.company} closed: ${str(output.note, 200) || "they declined"}`, extra: { action, company: lead.company } };
    }
    const step = o.step + 1;
    const subject = str(output.subject, 120) || `Re: ${o.subject ?? "DocLedger"}`;
    const body = str(output.body, 4000);
    const [row] = await ctx.db.insert(outreach).values({ leadId: lead.id, step, channel: "email", subject, bodyText: body, status: "draft", simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: outreach.id });
    const label = action === "propose_times" ? "Propose demo times to" : action === "book_confirm" ? "Confirm the demo with" : `Send follow up ${step} to`;
    const { id: approvalId } = await raiseApproval(ctx.db, {
      type: "outreach_email",
      summary: `${label} ${dm.name || "the contact"} at ${lead.company}`,
      content: { to: dm.email ?? "", toName: dm.name, company: lead.company, subject, body, outreachId: row?.id ?? null, step },
      riskNote: action === "follow_up" ? "Follow up on a cold thread. Opt out line included." : "Reply to a warm thread.",
      taskId: task.id,
      agentId: ctx.agentId,
      floorId: ctx.floorId,
    }, ctx.now);
    if (row) await ctx.db.update(outreach).set({ approvalId, updatedAt: ctx.now }).where(eq(outreach.id, row.id));
    if (output.demoBooked === true || action === "book_confirm") {
      await ctx.db.update(leads).set({ status: "demo_booked", updatedAt: ctx.now }).where(eq(leads.id, lead.id));
      await logEvent(ctx.db, { taskId: task.id, agentId: ctx.agentId, floorId: ctx.floorId, type: "milestone", message: `Demo booked with ${lead.company}`, at: ctx.now });
    }
    return { summary: action === "propose_times" ? `Reply received from ${lead.company}, proposing demo times` : action === "book_confirm" ? `Demo booked with ${lead.company}, confirmation waiting for approval` : `Follow up ${step} drafted for ${lead.company}`, extra: { action, company: lead.company, step } };
  },
};

export const PLAYBOOKS: Record<string, Playbook> = {
  find_leads: findLeads,
  qualify_lead: qualifyLead,
  draft_outreach: draftOutreach,
  follow_up: followUp,
  ...DEALS_PLAYBOOKS,
};

export function playbookFor(kind: string): Playbook | null {
  return PLAYBOOKS[kind] ?? null;
}

// How many real tasks of a kind exist for an agent today or in flight, used by the pipeline to avoid piling up.
export async function openTasksOfKind(db: Db, agentId: string, kind: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.agentId, agentId), eq(tasks.kind, kind), eq(tasks.simulated, false), sql`${tasks.status} in ('queued', 'running', 'review')`, isNull(tasks.parentTaskId)));
  return Number(r?.n ?? 0);
}

export type { LeadRow };
