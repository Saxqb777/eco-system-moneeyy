// D079: the owner's call sheet. Five companies a day worth a phone call or a WhatsApp from him: the ones that
// opened their demo and stayed quiet first, then good fits with no public email, then named contacts who never
// answered. Each row carries the phone, the opening line, the bill to talk about and the demo link. He marks
// how it went; the Chaser writes the follow up to the call.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leads, outreach, taskEvents } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { previewLink } from "@/lib/site";
import { enqueueMessage } from "@/lib/telegram";
import { dubaiParts } from "@/lib/time";
import { snoozeLead } from "@/agents/docledger-autonomy";

export const CALL_SHEET_SIZE = 5;
export const CALL_OUTCOMES = ["interested", "no_answer", "not_now", "no"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
const HOME_COUNTRIES = ["AE", "SA", "QA", "OM", "BH", "KW"];

export interface CallRow {
  leadId: string;
  company: string;
  contact: string | null;
  title: string | null;
  phone: string;
  city: string | null;
  country: string;
  why: string;
  opening: string;
  bill: string | null;
  demoUrl: string | null;
  emailed: boolean;
  visited: boolean;
  attempts: number;
  lastOutcome: CallOutcome | null;
}

interface CallLog {
  at: string;
  outcome: CallOutcome;
  note?: string;
}

function callLog(lead: typeof leads.$inferSelect): CallLog[] {
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  return Array.isArray(dm.calls) ? (dm.calls as CallLog[]) : [];
}

// Picks the day's five, once per Dubai day, and remembers them so the sheet does not shuffle under his thumb.
export async function callSheet(db: Db, now = new Date()): Promise<{ dayKey: string; rows: CallRow[] }> {
  const dayKey = dubaiParts(now).dayKey;
  const kept = await getSetting<{ dayKey?: string; leadIds?: string[] } | null>(db, "docledger_callsheet", null);
  let ids = kept?.dayKey === dayKey && Array.isArray(kept.leadIds) ? kept.leadIds : null;
  if (!ids) {
    ids = await pickToday(db, now);
    await setSetting(db, "docledger_callsheet", { dayKey, leadIds: ids });
  }
  if (!ids.length) return { dayKey, rows: [] };
  const rows = await db.select().from(leads).where(inArray(leads.id, ids));
  const byId = new Map(rows.map((l) => [l.id, l]));
  const out: CallRow[] = [];
  for (const id of ids) {
    const lead = byId.get(id);
    if (!lead || !lead.phone) continue;
    out.push(await rowFor(db, lead));
  }
  return { dayKey, rows: out };
}

async function pickToday(db: Db, now: Date): Promise<string[]> {
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 3600_000);
  const candidates = await db
    .select()
    .from(leads)
    .where(and(eq(leads.simulated, false), sql`coalesce(${leads.phone}, '') <> ''`, inArray(leads.status, ["contacted", "no_contact", "qualified", "drafted", "replied"]), sql`coalesce(${leads.segment}, '') not like 'partner%'`, inArray(leads.country, HOME_COUNTRIES)))
    .orderBy(desc(leads.score), asc(leads.createdAt))
    .limit(60);
  const scored = candidates
    .map((l) => {
      const calls = callLog(l);
      const last = calls.at(-1);
      // three tries is enough; a not now or a no takes them off the sheet
      if (calls.length >= 3 || last?.outcome === "not_now" || last?.outcome === "no" || last?.outcome === "interested") return null;
      if (last && new Date(last.at) > twoDaysAgo) return null;
      let rank = 0;
      if (l.demoVisitedAt) rank += 100;
      if (l.status === "no_contact") rank += 40;
      if (l.status === "contacted") rank += 20;
      rank += Number(l.score ?? 0);
      return { id: l.id, rank };
    })
    .filter((x): x is { id: string; rank: number } => !!x)
    .sort((a, b) => b.rank - a.rank);
  return scored.slice(0, CALL_SHEET_SIZE).map((x) => x.id);
}

async function rowFor(db: Db, lead: typeof leads.$inferSelect): Promise<CallRow> {
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  const preview = (lead.preview ?? {}) as { sampleDocument?: string };
  const [sent] = await db.select({ id: outreach.id }).from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false), inArray(outreach.status, ["sent", "replied", "handling", "answered", "reply_pending"]))).limit(1);
  const calls = callLog(lead);
  const research = Array.isArray(dm.research) ? (dm.research as string[]) : [];
  const fact = research[0] ?? lead.scoreReason ?? "";
  const bill = preview.sampleDocument ?? (typeof dm.angle === "string" && dm.angle ? dm.angle : null);
  const who = typeof dm.name === "string" && dm.name ? dm.name : null;
  const opening = who
    ? `Hi ${who.split(" ")[0]}, Saaqib from Doc Ledger in Abu Dhabi. ${fact ? `${fact.replace(/\.$/, "")}, so ` : ""}I set up a demo company for ${lead.company} that reads your ${bill ? bill.toLowerCase() : "shipping bills"} from a photo. Could I show you in ten minutes, or send the link on WhatsApp?`
    : `Hello, Saaqib from Doc Ledger in Abu Dhabi. Could I speak to whoever handles the shipping bills and receipts at month end? I set up a demo company for ${lead.company} that reads your ${bill ? bill.toLowerCase() : "shipping bills"} from a photo.`;
  return {
    leadId: lead.id,
    company: lead.company,
    contact: who,
    title: typeof dm.title === "string" && dm.title ? dm.title : null,
    phone: lead.phone ?? "",
    city: lead.city,
    country: lead.country,
    why: lead.demoVisitedAt ? "opened their demo and stayed quiet" : lead.status === "no_contact" ? "good fit, no public email" : sent ? "emailed, no reply" : "qualified, not emailed yet",
    opening,
    bill,
    demoUrl: lead.previewCode ? await previewLink(db, lead.previewCode) : null,
    emailed: !!sent,
    visited: !!lead.demoVisitedAt,
    attempts: calls.length,
    lastOutcome: calls.at(-1)?.outcome ?? null,
  };
}

// He called: the outcome goes on the lead and the floor acts on it.
export async function recordCall(db: Db, leadId: string, outcome: CallOutcome, note: string | null, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return { ok: false, message: "No such company on the sheet." };
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  const calls = [...callLog(lead), { at: now.toISOString(), outcome, ...(note ? { note } : {}) }].slice(-6);
  const patch: Record<string, unknown> = { ...dm, calls };
  let status = lead.status;
  let message = "";
  if (outcome === "interested") {
    status = "replied";
    patch.hotFromCall = now.toISOString();
    message = `${lead.company} marked interested. The Chaser drafts the email after the call for you to approve, with the demo link.`;
  } else if (outcome === "no_answer") {
    message = `${lead.company}: no answer. Back on the sheet in two days${calls.length >= 3 ? ", that was the last try" : ""}.`;
  } else if (outcome === "not_now") {
    message = `${lead.company}: not now. Paused 30 days, the Chaser checks back in then.`;
  } else {
    status = "lost";
    message = `${lead.company}: a no. Thread closed.`;
  }
  await db.update(leads).set({ decisionMaker: patch, status, updatedAt: now }).where(eq(leads.id, lead.id));
  if (outcome === "not_now") await snoozeLead(db, lead.id, 30, now);
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "call", message: `Owner called ${lead.company}: ${outcome.replace("_", " ")}${note ? ` (${note})` : ""}`, createdAt: now });
  return { ok: true, message };
}

// Finds a company on today's sheet by a loose name, for the Telegram command.
export async function findOnSheet(db: Db, name: string, now = new Date()): Promise<CallRow | null> {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const { rows } = await callSheet(db, now);
  return rows.find((r) => r.company.toLowerCase() === needle) ?? rows.find((r) => r.company.toLowerCase().includes(needle)) ?? null;
}

// The 10:00 Dubai card: today's five, ready to dial.
export async function callSheetCard(db: Db, now = new Date()): Promise<string | null> {
  const { rows } = await callSheet(db, now);
  if (!rows.length) {
    const li = await linkedinSheet(db, now);
    if (!li.length) return null;
    return [`Nobody to call today. LinkedIn: ${li.length} name${li.length === 1 ? "" : "s"}, two lines each, mark them in the game.`, ...li.map((r, i) => `${i + 1}. ${r.name}${r.title ? `, ${r.title}` : ""} at ${r.company}: ${r.profileUrl}`)].join("\n");
  }
  const lines = [`Call sheet for today: ${rows.length} compan${rows.length === 1 ? "y" : "ies"} worth 20 minutes.`, ""];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.company}${r.contact ? ` (${r.contact}${r.title ? `, ${r.title}` : ""})` : ""}, ${r.city ?? r.country}: ${r.phone}`);
    lines.push(`   Why: ${r.why}. ${r.bill ? `Talk about: ${r.bill}.` : ""}`);
    if (r.demoUrl) lines.push(`   Demo: ${r.demoUrl}`);
  });
  lines.push("", "After each call: /called <company>: interested, no answer, not now or no. The sheet is in the game under Warden, Mailbox, Call sheet.");
  const li = await linkedinSheet(db, now);
  if (li.length) {
    lines.push("", `LinkedIn today: ${li.length} name${li.length === 1 ? "" : "s"}, two lines each, mark them in the game.`);
    li.forEach((r, i) => lines.push(`${i + 1}. ${r.name}${r.title ? `, ${r.title}` : ""} at ${r.company}: ${r.profileUrl}`));
  }
  return lines.join("\n");
}

// Once a day at 10:00 Dubai, when there is anyone to call.
export async function maybeSendCallSheet(db: Db, now = new Date()): Promise<boolean> {
  const p = dubaiParts(now);
  if (p.hour < 10) return false;
  const marker = await getSetting<string | null>(db, "docledger_callsheet_sent", null);
  if (marker === p.dayKey) return false;
  await setSetting(db, "docledger_callsheet_sent", p.dayKey);
  const card = await callSheetCard(db, now);
  if (!card) return false;
  await enqueueMessage(db, { kind: "call_sheet", body: card, now });
  return true;
}

// D081: the owner's LinkedIn list. Five named contacts a day with a two line message he can paste, the ones that
// opened their demo first. Code writes the lines (no AI cost); he marks each one sent.
export const LINKEDIN_SHEET_SIZE = 5;

export interface LinkedinRow {
  leadId: string;
  company: string;
  name: string;
  title: string | null;
  profileUrl: string;
  // true when the profile is a search, not a known URL
  searched: boolean;
  message: string;
  demoUrl: string | null;
  visited: boolean;
}

export async function linkedinSheet(db: Db, now = new Date()): Promise<LinkedinRow[]> {
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600_000);
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.simulated, false), inArray(leads.status, ["contacted", "no_contact", "qualified", "drafted", "replied"]), sql`coalesce(${leads.segment}, '') not like 'partner%'`, sql`coalesce(${leads.decisionMaker} ->> 'name', '') <> ''`))
    .orderBy(desc(leads.demoVisitedAt), desc(leads.score), asc(leads.createdAt))
    .limit(80);
  const out: LinkedinRow[] = [];
  for (const lead of rows) {
    const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
    const asked = typeof dm.linkedinAskedAt === "string" ? new Date(dm.linkedinAskedAt) : null;
    if (asked && asked > monthAgo) continue;
    const name = String(dm.name ?? "").trim();
    if (!name) continue;
    const first = name.split(/\s+/)[0] ?? name;
    const preview = (lead.preview ?? {}) as { sampleDocument?: string };
    const docWord = (preview.sampleDocument ?? "").split(",")[0]!.trim().toLowerCase();
    const bill = docWord && docWord.length <= 40 ? docWord : "shipping bills";
    const demoUrl = lead.previewCode ? await previewLink(db, lead.previewCode) : null;
    const known = typeof dm.linkedin === "string" && /linkedin\.com\//.test(dm.linkedin) ? dm.linkedin : null;
    out.push({
      leadId: lead.id,
      company: lead.company,
      name,
      title: typeof dm.title === "string" && dm.title ? dm.title : null,
      profileUrl: known ?? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${name} ${lead.company}`)}`,
      searched: !known,
      message: `Hi ${first}, I build Doc Ledger in Abu Dhabi: it reads ${bill} from a photo, every charge line, so month end stops being retyping.${demoUrl ? ` I set up a demo company for ${lead.company}, no signup: ${demoUrl}` : ""} Worth a look?`,
      demoUrl,
      visited: !!lead.demoVisitedAt,
    });
    if (out.length >= LINKEDIN_SHEET_SIZE) break;
  }
  return out;
}

export async function recordLinkedin(db: Db, leadId: string, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return { ok: false, message: "No such company." };
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  await db.update(leads).set({ decisionMaker: { ...dm, linkedinAskedAt: now.toISOString() }, updatedAt: now }).where(eq(leads.id, lead.id));
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "linkedin", message: `Owner messaged ${String(dm.name ?? "the contact")} at ${lead.company} on LinkedIn`, createdAt: now });
  return { ok: true, message: `${lead.company}: LinkedIn message noted. Back on the list in a month if nothing comes of it.` };
}
