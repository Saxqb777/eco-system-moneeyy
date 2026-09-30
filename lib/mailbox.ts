// The DocLedger mailbox: one thread per company, every email the agents wrote and every reply that came back,
// in order, with how each email went out (on its own, approved by the owner, waiting for him, rejected).
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, leads, outreach } from "@/db/schema";

export type ThreadState = "hot" | "waiting" | "replied" | "sent" | "drafting" | "paused" | "demo" | "closed";
export type SentHow = "auto" | "approved" | "yours" | "waiting" | "rejected" | "replaced" | "draft";

export interface MailThread {
  leadId: string;
  company: string;
  contact: string | null;
  email: string | null;
  country: string | null;
  city: string | null;
  state: ThreadState;
  lastAt: string;
  lastLine: string;
  lastFrom: "us" | "them";
  messages: number;
}

export interface MailMessage {
  id: string;
  from: "us" | "them";
  step: number;
  subject: string | null;
  body: string;
  at: string;
  how: SentHow | null;
  status: string;
  approvalId: string | null;
  previewUrl: string | null;
}

export interface MailThreadDetail extends MailThread {
  title: string | null;
  leadStatus: string;
  previewUrl: string | null;
  items: MailMessage[];
}

type OutreachRow = typeof outreach.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type LeadRow = typeof leads.$inferSelect;

function howSent(a: ApprovalRow | undefined): SentHow {
  if (!a) return "draft";
  if (a.status === "pending") return "waiting";
  // decidedVia "owner": he wrote it himself with /send, or his own answer replaced this draft.
  if (a.status === "rejected") return a.decidedVia === "owner" ? "replaced" : "rejected";
  if (a.decidedVia === "owner") return "yours";
  return a.decidedVia === "auto" ? "auto" : "approved";
}

function messagesFor(rows: OutreachRow[], byApproval: Map<string, ApprovalRow>): MailMessage[] {
  const out: MailMessage[] = [];
  for (const r of rows) {
    const a = r.approvalId ? byApproval.get(r.approvalId) : undefined;
    if (r.bodyText && r.bodyText.trim()) {
      out.push({
        id: `${r.id}:out`,
        from: "us",
        step: r.step,
        subject: r.subject,
        body: r.bodyText,
        at: (r.sentAt ?? r.createdAt).toISOString(),
        how: howSent(a),
        status: r.status,
        approvalId: r.approvalId,
        previewUrl: a?.previewUrl ?? null,
      });
    }
    if (r.replyText && r.replyText.trim()) {
      out.push({ id: `${r.id}:in`, from: "them", step: r.step, subject: null, body: r.replyText, at: (r.replyAt ?? r.updatedAt).toISOString(), how: null, status: "reply", approvalId: null, previewUrl: null });
    }
  }
  return out.sort((x, y) => x.at.localeCompare(y.at) || (x.from === "us" ? -1 : 1));
}

function stateOf(lead: LeadRow, items: MailMessage[], pending: ApprovalRow[], now: Date): ThreadState {
  if (lead.status === "lost") return "closed";
  if (lead.status === "demo_booked" || lead.status === "client") return "demo";
  if (pending.some((a) => (a.content as { hot?: boolean } | null)?.hot === true)) return "hot";
  if (pending.length) return "waiting";
  const snooze = (lead.decisionMaker as { snoozeUntil?: string } | null)?.snoozeUntil;
  if (snooze && Date.parse(snooze) > now.getTime()) return "paused";
  const last = items.at(-1);
  if (last?.from === "them") return "replied";
  return items.some((m) => m.from === "us" && m.status === "sent") ? "sent" : "drafting";
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
};

async function load(db: Db, simulated: boolean, leadIds?: string[]) {
  const rows = await db
    .select()
    .from(outreach)
    .where(and(eq(outreach.simulated, simulated), ...(leadIds ? [inArray(outreach.leadId, leadIds)] : [])))
    .orderBy(desc(outreach.createdAt))
    .limit(leadIds ? 200 : 600);
  const ids = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
  const leadRows = ids.length ? await db.select().from(leads).where(inArray(leads.id, ids)) : [];
  const approvalIds = rows.map((r) => r.approvalId).filter((x): x is string => !!x);
  const approvalRows = approvalIds.length ? await db.select().from(approvals).where(inArray(approvals.id, approvalIds)) : [];
  return { rows, leadRows, byApproval: new Map(approvalRows.map((a) => [a.id, a])) };
}

function threadFrom(lead: LeadRow, rows: OutreachRow[], byApproval: Map<string, ApprovalRow>, now: Date): { thread: MailThread; items: MailMessage[] } {
  const own = rows.filter((r) => r.leadId === lead.id).sort((a, b) => a.step - b.step || a.createdAt.getTime() - b.createdAt.getTime());
  const items = messagesFor(own, byApproval);
  const pending = own.map((r) => (r.approvalId ? byApproval.get(r.approvalId) : undefined)).filter((a): a is ApprovalRow => !!a && a.status === "pending");
  const last = items.at(-1);
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  return {
    items,
    thread: {
      leadId: lead.id,
      company: lead.company,
      contact: typeof dm.name === "string" && dm.name ? dm.name : null,
      email: typeof dm.email === "string" && dm.email ? dm.email : null,
      country: lead.country ?? null,
      city: lead.city ?? null,
      state: stateOf(lead, items, pending, now),
      lastAt: last?.at ?? lead.updatedAt.toISOString(),
      lastLine: last ? clip(last.from === "us" && last.subject ? `${last.subject}: ${last.body}` : last.body, 110) : "",
      lastFrom: last?.from ?? "us",
      messages: items.length,
    },
  };
}

const ORDER: Record<ThreadState, number> = { hot: 0, waiting: 1, replied: 2, demo: 3, sent: 4, drafting: 5, paused: 6, closed: 7 };

export async function listThreads(db: Db, simulated: boolean, filter: "all" | "hot" | "waiting" = "all", now = new Date()): Promise<MailThread[]> {
  const { rows, leadRows, byApproval } = await load(db, simulated);
  const threads = leadRows.map((l) => threadFrom(l, rows, byApproval, now).thread);
  const kept = filter === "hot" ? threads.filter((t) => t.state === "hot") : filter === "waiting" ? threads.filter((t) => t.state === "hot" || t.state === "waiting") : threads;
  return kept.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.lastAt.localeCompare(a.lastAt)).slice(0, 80);
}

export async function threadDetail(db: Db, leadId: string, now = new Date()): Promise<MailThreadDetail | null> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;
  const { rows, byApproval } = await load(db, lead.simulated, [lead.id]);
  const { thread, items } = threadFrom(lead, rows, byApproval, now);
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  const base = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
  return { ...thread, title: typeof dm.title === "string" && dm.title ? dm.title : null, leadStatus: lead.status, previewUrl: lead.previewCode ? `${base}/for/${lead.previewCode}` : null, items };
}

export function mailboxCounts(threads: MailThread[]): { hot: number; waiting: number } {
  return { hot: threads.filter((t) => t.state === "hot").length, waiting: threads.filter((t) => t.state === "waiting" || t.state === "hot").length };
}
