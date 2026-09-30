// Worker playbooks for the live floors. Each one prepares the request from the database and absorbs the
// structured answer back into rows. Every playbook forbids hyphens and em dashes in its output (rule 7).
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leads, outreach, tasks } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { shortCode } from "@/lib/affiliate";
import { clipboardValue } from "@/lib/clipboard";
import { DOCLEDGER, docledgerKnowledge } from "@/config/docledger";
import { normaliseCountry, regionFor, skippedCountries } from "@/lib/markets";
import { DEALS_PLAYBOOKS } from "./deals-playbooks";
import { GROWTH_PLAYBOOKS } from "./growth-playbooks";
import { experimentLines } from "./experiments";
import { REPLY_INTENTS, autoSendAllowed, isHot, notifyHotLead, snoozeLead } from "./docledger-autonomy";
import { STYLE, input, logEvent, num, str, type Playbook, type PlaybookContext, type TaskRow } from "./playbook-core";
import { plainDashes } from "@/lib/text";
import { previewLink, siteLine } from "@/lib/site";
import { RESEARCH_EFFORT } from "@/config/models";
export type { Absorbed, Playbook, PlaybookContext, Prepared } from "./playbook-core";

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

// The price line and the signature block are the owner's; the product story lives in config/docledger.ts.
async function facts(db: Db): Promise<string> {
  const own = await clipboardValue(db, "docledger_product_facts");
  const address = await clipboardValue(db, "business_address");
  return `${docledgerKnowledge()}\n\nPrice and signature from the owner: ${own ?? "not pasted yet. Do not quote a price. Sign as: The Doc Ledger team."}${address ? `\nPostal address, the last line of the signature: ${address}` : ""}${await siteLine(db)}`;
}

// The preview link goes where the Writer put {preview}. When the Writer already introduced it ("I made a
// page for you:"), only the link goes in, so the email never says it twice.
export function insertPreview(body: string, company: string, url: string): string {
  const line = `I set up a demo company for ${company}, no signup needed: ${url}`;
  const at = body.indexOf("{preview}");
  if (at < 0) return `${body.trimEnd()}\n\n${line}`;
  const lastLine = body.slice(0, at).trimEnd().split("\n").pop() ?? "";
  return body.replace("{preview}", /:$/.test(lastLine) ? url : line);
}

// Scout: real companies anywhere in the world, never invented. One region a day unless Warden gives a focus.
const findLeads: Playbook = {
  kind: "find_leads",
  effort: RESEARCH_EFFORT,
  webSearchMaxUses: 5,
  maxTokens: 2500,
  system: `You are Scout on the DocLedger Sales floor of The Tower.
${docledgerKnowledge()}
Your job: find real companies, anywhere in the world, whose finance team keys shipping bills, fuel receipts and petty cash by hand: freight forwarders and customs brokers first, then food and beverage distributors, trading companies with their own fleets, and small third party logistics firms (3PL). Doc Ledger is software, so any country where business is done in English works. Search the region you are given.
Use web search, at most a few queries, and read what the results say. Return up to 12 companies you actually saw named on a page, each with the page you saw it on, its country as a two letter code (GB, US, AU, SG, AE and so on), and one line on why their paperwork fits. Skip anything in the exclusion list and any country in the skip list. Prefer small and medium firms, not the global giants.
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
          required: ["company", "website", "segment", "city", "country", "sourceUrl", "phone", "why"],
          properties: {
            company: { type: "string" },
            website: { type: "string", description: "the company's own website root URL; search for it if the page you found does not link it, empty only if it truly has none" },
            segment: { type: "string", enum: ["freight_forwarder", "customs_broker", "small_3pl", "distributor", "trading_company"] },
            city: { type: "string" },
            country: { type: "string", description: "two letter country code, for example GB, US, AU, SG, AE" },
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
    const focus = str(input(task).instructions) || `Freight forwarders and customs brokers in ${regionFor(ctx.now)}.`;
    const skip = await skippedCountries(ctx.db);
    const skipLine = Object.entries(skip).map(([c, why]) => `${c} (${why})`).join("; ") || "none";
    return { user: `Focus from Warden: ${focus}\n${await experimentLines(ctx.db, ctx.now, "scout")}Today: ${ctx.now.toISOString().slice(0, 10)}\nSkip these countries: ${skipLine}\nExclusion list (already known): ${exclude}\n\nSearch the web before you answer. An answer without a search is not accepted. Find the leads and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const rows = Array.isArray(output.leads) ? output.leads : [];
    let inserted = 0;
    let dupes = 0;
    let skipped = 0;
    const skip = await skippedCountries(ctx.db);
    for (const raw of rows) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const company = str(r.company, 120);
      if (!company) continue;
      const country = normaliseCountry(str(r.country, 10));
      if (!country || skip[country]) {
        skipped += 1;
        continue;
      }
      const website = str(r.website, 200) || null;
      const key = dedupeKeyFor(company, website);
      const [ins] = await ctx.db
        .insert(leads)
        .values({ floorId: ctx.floorId, company, website, segment: str(r.segment, 40) || "freight_forwarder", city: str(r.city, 60) || null, country, phone: str(r.phone, 40) || null, sourceUrl: str(r.sourceUrl, 300) || null, scoreReason: str(r.why, 300) || null, status: "new", dedupeKey: key, foundByTaskId: task.id, simulated: false, createdAt: ctx.now, updatedAt: ctx.now })
        .onConflictDoNothing()
        .returning({ id: leads.id });
      if (ins) inserted += 1;
      else dupes += 1;
    }
    return { summary: `Found ${inserted} new lead${inserted === 1 ? "" : "s"}${dupes ? `, ${dupes} already known` : ""}${skipped ? `, ${skipped} in a country we skip` : ""}`, extra: { found: inserted, duplicates: dupes, skippedCountry: skipped, note: str(output.note, 300) } };
  },
};

// Analyst: score the fit, find the decision maker.
const qualifyLead: Playbook = {
  kind: "qualify_lead",
  effort: RESEARCH_EFFORT,
  webSearchMaxUses: 3,
  webFetchMaxUses: 4,
  maxTokens: 2500,
  system: `You are Analyst on the DocLedger Sales floor of The Tower.
${docledgerKnowledge()}
For one company: judge how well Doc Ledger fits (1 to 10), find the person who would buy it (finance manager, accounts manager, operations manager, managing director or owner), and do a little research so Writer can open with something true about them: what they move or sell, their fleet or routes, how many branches, anything recent. Two or three facts, each one sentence, each one seen on a page. Then pick the angle: which pain is theirs most (shipping bills, fuel receipts, petty cash, foreign currency, duplicates, their own document types). Last, think like their salesperson and write the approach: which true fact to open with, which of their documents to show in the demo company made for them, and why it matters to them now. The owner reads it before he approves the email.
Find the email: open the company website with the fetch tool (search for it first if you do not have it), then its contact, about or team page. A named person's work email is best; a general company address on the site such as info@, accounts@, finance@, sales@ or operations@ is fine when no named one is public. Copy it exactly as written on the page. If there is none, leave it empty and say so, never guess one. Return the website you used.
A score of 6 or more means qualified. Finance teams handling freight invoices and fleets score high. Couriers, airlines and shipping lines score low.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["score", "reason", "qualified", "decisionMaker", "research", "angle", "approach", "website", "notes"],
    properties: {
      website: { type: "string", description: "the company website you used, root URL, or empty" },
      score: { type: "integer" },
      reason: { type: "string" },
      qualified: { type: "boolean" },
      decisionMaker: {
        type: "object",
        additionalProperties: false,
        required: ["name", "title", "email", "linkedin", "confidence"],
        properties: { name: { type: "string" }, title: { type: "string" }, email: { type: "string" }, linkedin: { type: "string" }, confidence: { type: "number" } },
      },
      research: { type: "array", items: { type: "string" }, description: "two or three true facts about the company, one sentence each" },
      angle: { type: "string", description: "the pain that fits them most, in a few words" },
      approach: { type: "string", description: "two sentences: the fact to open with, the document to show in their demo, and why now" },
      notes: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const leadId = str(input(task).leadId);
    const [lead] = leadId ? await ctx.db.select().from(leads).where(eq(leads.id, leadId)).limit(1) : [];
    if (!lead) return { skip: "No lead attached to this task" };
    const retry = input(task).retry === true;
    if (lead.status !== "new" && !(retry && lead.status === "no_contact")) return { skip: `Lead ${lead.company} is already ${lead.status}` };
    const f = await facts(ctx.db);
    return { user: `Product facts:\n${f}\n\n${await experimentLines(ctx.db, ctx.now, "analyst")}${retry ? "Second try: the first look found no email. Open the website and its contact page this time.\n" : ""}Company: ${lead.company}\nCountry: ${lead.country}\nWebsite: ${lead.website ?? "unknown, search for it"}\nSegment: ${lead.segment ?? "unknown"}\nCity: ${lead.city ?? "unknown"}\nSeen at: ${lead.sourceUrl ?? "unknown"}\nScout's note: ${lead.scoreReason ?? ""}\n\nOpen the website and its contact or about page${lead.website ? "" : " (search for it first)"}, and search for the finance or operations lead. Qualify this company and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const leadId = str(input(task).leadId);
    const dmRaw = (output.decisionMaker ?? {}) as Record<string, unknown>;
    const email = str(dmRaw.email, 120).toLowerCase();
    const research = Array.isArray(output.research) ? output.research.filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.trim().slice(0, 240)).slice(0, 4) : [];
    const retried = input(task).retry === true;
    const dm = { name: str(dmRaw.name, 80), title: str(dmRaw.title, 80), email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "", linkedin: str(dmRaw.linkedin, 200), confidence: Math.min(1, Math.max(0, num(dmRaw.confidence, 0))), research, angle: str(output.angle, 80), approach: plainDashes(str(output.approach, 400)), ...(retried ? { retried: true } : {}) };
    const score = Math.min(10, Math.max(1, Math.round(num(output.score, 1))));
    const qualified = output.qualified === true && score >= 6;
    const status = !qualified ? "disqualified" : dm.email ? "qualified" : "no_contact";
    const site = str(output.website, 200);
    const [before] = await ctx.db.select({ website: leads.website }).from(leads).where(eq(leads.id, leadId)).limit(1);
    const website = before?.website || (/^https?:\/\//.test(site) ? site : null);
    await ctx.db.update(leads).set({ score, scoreReason: str(output.reason, 400) || null, decisionMaker: dm, status, website, updatedAt: ctx.now }).where(eq(leads.id, leadId));
    const [lead] = await ctx.db.select({ company: leads.company }).from(leads).where(eq(leads.id, leadId)).limit(1);
    const company = lead?.company ?? "the lead";
    return { summary: `Scored ${company}: ${score}/10, ${status === "qualified" ? `${dm.name || "decision maker"} found` : status === "no_contact" ? "qualified but no public email" : "not a fit"}`, extra: { company, score, qualified, status } };
  },
};

// Writer: one personalised email, never sent by itself.
const draftOutreach: Playbook = {
  kind: "draft_outreach",
  webSearchMaxUses: 2,
  maxTokens: 1500,
  system: `You are Writer on the DocLedger Sales floor of The Tower. You write one first email to the decision maker at a qualified company. Until the owner switches on auto send your email waits for his approval; after that it goes out on its own, so write every email as if it will be sent as it is.
${docledgerKnowledge()}

Rules for the email:
${DOCLEDGER.emailRules.map((r) => `- ${r}`).join("\n")}

Subject lines that work: ${DOCLEDGER.subjectExamples.join(" / ")}

The reference email (match its shape and length, never copy it word for word, and make the first two sentences theirs):
${DOCLEDGER.emailExample}

Use the Analyst's research for the opening detail. If the research is thin, one web search to find one true detail about the company is allowed; if you find nothing, open with their paperwork, not with a guess.

Use the Analyst's approach when there is one: open where it says, show the document it picked.

The link opens a demo company named after them in the real Doc Ledger, with one of their kinds of document already read. Alongside the email, describe that document and a short page about it: a headline in their terms, an intro that continues from their first name, three sentences on what changes for them, and the sample document they handle most with six to eight fields the system would read off it (example values, clearly examples, never real amounts you did not see). Put the line {preview} on its own in the email right after the sentence that introduces the demo, before the ask.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body", "personalisation", "preview"],
    properties: {
      subject: { type: "string" },
      body: { type: "string", description: "the email, 60 to 100 words, with the line {preview} on its own right after the sentence that introduces the demo company, before the ask" },
      personalisation: { type: "string", description: "the specific detail you used and where it came from" },
      preview: {
        type: "object",
        additionalProperties: false,
        required: ["headline", "intro", "points", "sampleDocument", "sampleFields"],
        description: "a one page preview made for this company, linked from the email",
        properties: {
          headline: { type: "string", description: "under 10 words, their paperwork, no product name" },
          intro: { type: "string", description: "one or two sentences continuing from the reader's first name, about their month end" },
          points: { type: "array", items: { type: "string" }, description: "three sentences: what changes for them, in their terms" },
          sampleDocument: { type: "string", description: "the document they handle most, for example Shipping line bill, Maersk, Felixstowe" },
          sampleFields: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "value"], properties: { field: { type: "string" }, value: { type: "string" } } }, description: "six to eight fields the system would read off that document, with plausible example values marked as examples" },
        },
      },
    },
  },
  async prepare(task, ctx) {
    const leadId = str(input(task).leadId);
    const [lead] = leadId ? await ctx.db.select().from(leads).where(eq(leads.id, leadId)).limit(1) : [];
    if (!lead) return { skip: "No lead attached to this task" };
    const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
    const email = typeof dm.email === "string" ? dm.email : "";
    if (!email) return { skip: `${lead.company} has no public email yet` };
    const research = Array.isArray(dm.research) ? (dm.research as string[]) : [];
    const feedback = str(input(task).feedback);
    const f = await facts(ctx.db);
    return {
      user: `${f}\n\n${await experimentLines(ctx.db, ctx.now, "writer")}Company: ${lead.company} (${lead.segment ?? "company"}, ${[lead.city, lead.country].filter(Boolean).join(", ")})\nWrite for a reader in ${lead.country}: their spelling, their currency in any example, no Gulf place names unless they are in the Gulf.\nWebsite: ${lead.website ?? "unknown"}\nWhy they fit: ${lead.scoreReason ?? ""}\nAngle: ${typeof dm.angle === "string" && dm.angle ? dm.angle : "shipping bills and petty cash"}\n${typeof dm.approach === "string" && dm.approach ? `Analyst's approach: ${dm.approach}\n` : ""}Research:\n${research.length ? research.map((r) => `- ${r}`).join("\n") : "- nothing yet, one web search allowed"}\nDecision maker: ${typeof dm.name === "string" && dm.name ? dm.name : "unknown"}, ${typeof dm.title === "string" && dm.title ? dm.title : "unknown title"}\n${feedback ? `Warden's feedback on the last draft: ${feedback}\n` : ""}\nWrite the email and return the JSON object.`,
      webSearchMaxUses: research.length >= 2 ? 0 : 2,
    };
  },
  async absorb(task, output, ctx) {
    const leadId = str(input(task).leadId);
    const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return { summary: "Lead vanished before the draft landed" };
    const dm = (lead.decisionMaker ?? {}) as Record<string, string>;
    let subject = plainDashes(str(output.subject, 120)) || DOCLEDGER.subjectExamples[0];
    if (/\bAI\b/i.test(subject)) subject = DOCLEDGER.subjectExamples[0];
    const previewRaw = (output.preview ?? {}) as Record<string, unknown>;
    const points = Array.isArray(previewRaw.points) ? previewRaw.points.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 4) : [];
    const sampleFields = Array.isArray(previewRaw.sampleFields) ? previewRaw.sampleFields.filter((f): f is { field: string; value: string } => !!f && typeof f === "object" && typeof (f as { field?: unknown }).field === "string" && typeof (f as { value?: unknown }).value === "string").slice(0, 8) : [];
    const preview = str(previewRaw.headline, 120) && points.length >= 2 ? { headline: plainDashes(str(previewRaw.headline, 120)), intro: plainDashes(str(previewRaw.intro, 400)), points: points.map(plainDashes), sampleDocument: str(previewRaw.sampleDocument, 120) || "Shipping line bill", sampleFields } : null;
    // docledger.site once it is live (D067), the Tower's address until then.
    const previewCode = preview ? (lead.previewCode ?? shortCode()) : null;
    const previewUrl = previewCode ? await previewLink(ctx.db, previewCode) : null;
    let body = plainDashes(str(output.body, 4000));
    if (previewUrl) body = insertPreview(body, lead.company, previewUrl);
    else body = body.replace(/\n?\{preview\}\n?/g, "\n");
    if (preview) await ctx.db.update(leads).set({ preview, previewCode, updatedAt: ctx.now }).where(eq(leads.id, lead.id));
    const words = body.split(/\s+/).filter(Boolean).length;
    const [row] = await ctx.db.insert(outreach).values({ leadId: lead.id, step: 1, channel: "email", subject, bodyText: body, status: "draft", simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: outreach.id });
    const auto = await autoSendAllowed(ctx.db, ctx.floorId, ctx.now);
    const { id: approvalId } = await raiseApproval(ctx.db, {
      type: "outreach_email",
      summary: `Send first outreach email to ${dm.name || "the decision maker"} at ${lead.company}`,
      content: { to: dm.email, toName: dm.name, company: lead.company, subject, body, outreachId: row?.id ?? null, previewUrl },
      previewUrl,
      riskNote: `Cold email to a business address. One plain opt out line included. The link opens a demo company named after them.${typeof dm.approach === "string" && dm.approach ? ` Approach: ${dm.approach}` : ""}`,
      taskId: task.id,
      agentId: ctx.agentId,
      floorId: ctx.floorId,
      autoApproved: auto,
    }, ctx.now);
    if (row) await ctx.db.update(outreach).set({ approvalId, updatedAt: ctx.now }).where(eq(outreach.id, row.id));
    await ctx.db.update(leads).set({ status: "drafted", updatedAt: ctx.now }).where(eq(leads.id, lead.id));
    return { summary: auto ? `Outreach for ${lead.company} goes out on its own (floor rule)` : `Outreach drafted for ${lead.company}, waiting for approval`, extra: { company: lead.company, subject, words, autoSent: auto, personalisation: str(output.personalisation, 200) } };
  },
};

// Chaser: follow ups and replies, demo booking with the calendar link.
const followUp: Playbook = {
  kind: "follow_up",
  webSearchMaxUses: 0,
  maxTokens: 1200,
  system: `You are Chaser on the DocLedger Sales floor of The Tower. You handle the thread after the first email. Routine emails you write (follow ups, answers to simple questions, a polite reply to not now) may go out on their own once the owner has switched that on. Anything that smells like a sale (a demo, a price, a trial, a contract, a meeting) goes to the owner first: he closes.
${docledgerKnowledge()}

When they reply, answer what they actually asked, then walk them through the parts that matter to them, in this order and in your own words:
${DOCLEDGER.replyWalkthrough.map((r, i) => `${i + 1}. ${r}`).join("\n")}
Lead with the third point whenever their reply mentions their own paperwork, a document type, or a tool they tried: it is the card a competitor cannot answer quickly.
If they ask for a document type or a feature we do not have, say the builder covers custom types and note the request plainly in your note field so Warden can raise a ticket.

Read the thread and the reply if there is one, then choose:
- follow_up: no reply yet, write a short nudge with one new angle from this list, never one already used in the thread: ${DOCLEDGER.followUpAngles.join(" | ")}
- propose_times: they are interested, answer their question, offer the calendar link to pick a 15 minute slot.
- book_confirm: they picked or confirmed a time, confirm it warmly and say what the demo covers (their own receipts, ten minutes).
- close: they said no or stop, or asked not to be contacted. Write nothing to send, just note it.
Also classify their reply as intent:
- no_reply: there is no reply, you are writing a follow up.
- question: a simple question about how it works, answer it.
- interested: they want a demo, a call, a trial, the price, a quote, or to talk to someone. The owner answers these himself, you write the suggested answer.
- booking: they picked or confirmed a time.
- not_now: maybe later, busy season, check back next quarter. Write a short friendly reply that you will check back in a month, no pitch.
- no: they are not interested. Use close.
- unsubscribe: they asked to be removed. Use close.
- out_of_office: an automatic away message. Use close for the action, write nothing, the Tower will check back in a week.
- other: anything else.
Write summary as one plain line for the owner: who, what they said, what they want.
Replies under 160 words, follow ups under 90. No bullet lists, no emojis, no exclamation marks. Include the opt out line only in follow_up. A good last line for a warm reply: ${DOCLEDGER.closingLine}
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["action", "intent", "summary", "subject", "body", "demoBooked", "note"],
    properties: {
      action: { type: "string", enum: ["follow_up", "propose_times", "book_confirm", "close"] },
      intent: { type: "string", enum: REPLY_INTENTS },
      summary: { type: "string", description: "one line for the owner: who, what they said, what they want" },
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
    // Partners and companies in their free month read differently from a prospect.
    const who = lead.segment?.startsWith("partner")
      ? "This contact is a possible referral partner, not a customer: talk about the partnership (they refer clients, a share of the fee agreed on a call with the founder), never pitch them as a buyer.\n"
      : lead.status === "trial"
        ? "This company is in its free first month: help them, answer fully, no selling.\n"
        : "";
    const lines = thread.map((t) => `Step ${t.step} (${t.status}${t.sentAt ? `, sent ${t.sentAt.toISOString().slice(0, 10)}` : ""}):\nSubject: ${t.subject ?? ""}\n${t.bodyText ?? ""}${t.replyText ? `\n\nTheir reply (${t.replyAt?.toISOString().slice(0, 10) ?? ""}):\n${t.replyText}` : ""}`);
    const checkIn = input(task).mode === "check_in";
    const mode = checkIn ? `They asked for time or were away. It is time to check back in: write a short, friendly follow up step ${o.step + 1} that picks up from their last message.` : o.replyText ? "They replied. Handle the reply." : `No reply after step ${o.step}. Write follow up step ${o.step + 1}.`;
    return { user: `Product facts and signature:\n${f}\n\n${await experimentLines(ctx.db, ctx.now, "chaser")}${who}Calendar link: ${calendar || "not pasted yet, ask them for two times instead"}\nCompany: ${lead.company}, contact ${(lead.decisionMaker as Record<string, string> | null)?.name ?? "unknown"}\nToday: ${ctx.now.toISOString().slice(0, 10)}\n\nThread:\n${lines.join("\n\n")}\n\n${mode}\nReturn the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const outreachId = str(input(task).outreachId);
    const [o] = await ctx.db.select().from(outreach).where(eq(outreach.id, outreachId)).limit(1);
    if (!o || !o.leadId) return { summary: "Thread vanished" };
    const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, o.leadId)).limit(1);
    if (!lead) return { summary: "Lead vanished" };
    const action = str(output.action, 20) || "follow_up";
    const intent = (REPLY_INTENTS as string[]).includes(str(output.intent, 20)) ? str(output.intent, 20) : o.replyText ? "other" : "no_reply";
    const ownerLine = str(output.summary, 300);
    const dm = (lead.decisionMaker ?? {}) as Record<string, string>;
    // The reply is handled now: "answered" keeps the pipeline from picking the same reply up again.
    if (o.status === "handling" || o.status === "replied") await ctx.db.update(outreach).set({ status: "answered", updatedAt: ctx.now }).where(eq(outreach.id, o.id));
    if (intent === "out_of_office") {
      await snoozeLead(ctx.db, lead.id, 7, ctx.now);
      return { summary: `${lead.company} is away, checking back in a week`, extra: { action: "snooze", intent, company: lead.company } };
    }
    if (action === "close") {
      await ctx.db.update(leads).set({ status: "lost", updatedAt: ctx.now }).where(eq(leads.id, lead.id));
      return { summary: `${lead.company} closed: ${str(output.note, 200) || "they declined"}`, extra: { action, intent, company: lead.company } };
    }
    if (intent === "not_now") await snoozeLead(ctx.db, lead.id, 30, ctx.now);
    const hot = isHot(intent, action);
    const step = o.step + 1;
    const subject = plainDashes(str(output.subject, 120)) || `Re: ${o.subject ?? "DocLedger"}`;
    const body = plainDashes(str(output.body, 4000));
    const [row] = await ctx.db.insert(outreach).values({ leadId: lead.id, step, channel: "email", subject, bodyText: body, status: "draft", simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: outreach.id });
    const label = hot ? "Hot lead: answer" : action === "propose_times" ? "Propose demo times to" : action === "book_confirm" ? "Confirm the demo with" : `Send follow up ${step} to`;
    const auto = !hot && (await autoSendAllowed(ctx.db, ctx.floorId, ctx.now));
    const { id: approvalId } = await raiseApproval(ctx.db, {
      type: "outreach_email",
      summary: `${label} ${dm.name || "the contact"} at ${lead.company}${hot && ownerLine ? `: ${ownerLine}` : ""}`.slice(0, 200),
      content: { to: dm.email ?? "", toName: dm.name, company: lead.company, subject, body, outreachId: row?.id ?? null, step, intent, hot, ownerLine },
      riskNote: hot ? "They are warm: this is yours to close. Approve to send the suggested answer, or reject with one line of what to change." : action === "follow_up" ? "Follow up on a cold thread. Opt out line included." : "Reply to a warm thread.",
      taskId: task.id,
      agentId: ctx.agentId,
      floorId: ctx.floorId,
      autoApproved: auto,
    }, ctx.now);
    if (row) await ctx.db.update(outreach).set({ approvalId, updatedAt: ctx.now }).where(eq(outreach.id, row.id));
    if (hot) await notifyHotLead(ctx.db, { company: lead.company, contact: dm.name ? `${dm.name}${dm.title ? `, ${dm.title}` : ""}` : null, summary: ownerLine || `${lead.company} replied and looks interested.`, reply: o.replyText ?? "", suggested: body }, ctx.now);
    if (output.demoBooked === true || action === "book_confirm") {
      await ctx.db.update(leads).set({ status: "demo_booked", updatedAt: ctx.now }).where(eq(leads.id, lead.id));
      await logEvent(ctx.db, { taskId: task.id, agentId: ctx.agentId, floorId: ctx.floorId, type: "milestone", message: `Demo booked with ${lead.company}`, at: ctx.now });
    }
    return { summary: hot ? `Hot reply from ${lead.company}, sent to the owner to close` : action === "book_confirm" ? `Demo booked with ${lead.company}` : auto ? `Follow up ${step} for ${lead.company} goes out on its own` : `Follow up ${step} drafted for ${lead.company}`, extra: { action, intent, hot, autoSent: auto, company: lead.company, step } };
  },
};

export const PLAYBOOKS: Record<string, Playbook> = {
  find_leads: findLeads,
  qualify_lead: qualifyLead,
  draft_outreach: draftOutreach,
  follow_up: followUp,
  ...DEALS_PLAYBOOKS,
  ...GROWTH_PLAYBOOKS,
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

