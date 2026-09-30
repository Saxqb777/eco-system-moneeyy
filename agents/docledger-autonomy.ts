// DocLedger runs mostly on its own. After the owner has approved ten emails in a row, the Tower asks once to send
// routine emails without a tap (first emails, follow ups, answers to simple questions), at most a set number a day.
// Hot replies (someone wants a demo, a price, a trial) always go to the owner with their words and a suggested answer.
import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, floors, leads, outreach } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { asNumber, getSettings } from "@/lib/settings";
import { enqueueMessage } from "@/lib/telegram";
import { dubaiDayStartUtc, dubaiWeekStartUtc } from "@/lib/time";

export const AUTO_SEND_DECISION = "Auto send DocLedger emails";
export const TRUST_APPROVALS = 10;
export const DEFAULT_AUTO_SEND_CAP = 15;
const DAY_MS = 24 * 3600 * 1000;

export type ReplyIntent = "no_reply" | "question" | "interested" | "booking" | "not_now" | "no" | "unsubscribe" | "out_of_office" | "other";
export const REPLY_INTENTS: ReplyIntent[] = ["no_reply", "question", "interested", "booking", "not_now", "no", "unsubscribe", "out_of_office", "other"];

// The last ten emails the owner decided himself: all approved means the Writer and Chaser have earned his trust.
// His own /send emails do not count: they are his words, not the workers'.
export async function trustEarned(db: Db): Promise<{ earned: boolean; approvedInARow: number }> {
  const rows = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.type, "outreach_email"), eq(approvals.simulated, false), inArray(approvals.status, ["approved", "rejected"]), notInArray(approvals.decidedVia, ["auto", "owner"])))
    .orderBy(desc(approvals.decidedAt))
    .limit(TRUST_APPROVALS);
  let inARow = 0;
  for (const r of rows) {
    if (r.status !== "approved") break;
    inARow += 1;
  }
  return { earned: inARow >= TRUST_APPROVALS, approvedInARow: inARow };
}

// Raised by code, once: when trust is earned, the floor is not on auto yet, and no such item is pending or was turned down this week.
export async function maybeRaiseAutoSend(db: Db, floor: typeof floors.$inferSelect, now: Date): Promise<boolean> {
  if (floor.autoApprove) return false;
  const { earned } = await trustEarned(db);
  if (!earned) return false;
  const [open] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.type, "decision"), eq(approvals.summary, AUTO_SEND_DECISION), sql`(${approvals.status} = 'pending' or ${approvals.createdAt} >= ${new Date(now.getTime() - 7 * DAY_MS)})`))
    .limit(1);
  if (open) return false;
  const cap = await autoSendCap(db);
  await raiseApproval(
    db,
    {
      type: "decision",
      summary: AUTO_SEND_DECISION,
      content: { autoApproveFloor: "docledger", text: `You approved the last ${TRUST_APPROVALS} DocLedger emails without a rejection. From now on routine emails go out on their own.` },
      riskNote: `First emails, follow ups and answers to simple questions go out without a tap, at most ${cap} a day. Hot replies (someone wants a demo, a price or a trial) still come to you first. /pause docledger stops the floor.`,
      floorId: floor.id,
    },
    now,
  );
  return true;
}

export async function autoSendCap(db: Db): Promise<number> {
  const s = await getSettings(db);
  return Math.max(0, Math.floor(asNumber(s.docledger_auto_send_cap, DEFAULT_AUTO_SEND_CAP)));
}

// Whether a routine email raised now may skip the owner: the floor switch is on and today's automatic sends are under the cap.
export async function autoSendAllowed(db: Db, floorId: string | null, now: Date): Promise<boolean> {
  if (!floorId) return false;
  const [floor] = await db.select().from(floors).where(eq(floors.id, floorId)).limit(1);
  if (!floor?.autoApprove || floor.slug !== "docledger") return false;
  const [today] = await db
    .select({ n: sql<string>`count(*)` })
    .from(approvals)
    .where(and(eq(approvals.type, "outreach_email"), eq(approvals.simulated, false), eq(approvals.decidedVia, "auto"), gte(approvals.decidedAt, dubaiDayStartUtc(now))));
  return Number(today?.n ?? 0) < (await autoSendCap(db));
}

export function isHot(intent: string, action: string): boolean {
  return intent === "interested" || intent === "booking" || action === "propose_times" || action === "book_confirm";
}

export async function notifyHotLead(db: Db, x: { company: string; contact: string | null; summary: string; reply: string; suggested: string }, now: Date): Promise<void> {
  const lines = [
    `Hot lead: ${x.company}${x.contact ? ` (${x.contact})` : ""}`,
    x.summary,
    "",
    "They wrote:",
    x.reply.slice(0, 700),
    "",
    "Suggested answer (approve it on the approval message, or reject with a line of what to change):",
    x.suggested.slice(0, 1200),
  ];
  await enqueueMessage(db, { kind: "hot_lead", body: lines.join("\n").slice(0, 3900), now });
}

export async function snoozeLead(db: Db, leadId: string, days: number, now: Date): Promise<void> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;
  const dm = { ...((lead.decisionMaker ?? {}) as Record<string, unknown>), snoozeUntil: new Date(now.getTime() + days * DAY_MS).toISOString() };
  await db.update(leads).set({ decisionMaker: dm, updatedAt: now }).where(eq(leads.id, leadId));
}

export function snoozedUntil(lead: typeof leads.$inferSelect): Date | null {
  const v = (lead.decisionMaker as Record<string, unknown> | null)?.snoozeUntil;
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
}

export async function clearSnooze(db: Db, lead: typeof leads.$inferSelect, now: Date): Promise<void> {
  const dm = { ...((lead.decisionMaker ?? {}) as Record<string, unknown>) };
  delete dm.snoozeUntil;
  await db.update(leads).set({ decisionMaker: dm, updatedAt: now }).where(eq(leads.id, lead.id));
}

// The sales funnel as a manager reads it: this week's leads, sends, replies, hot threads and demos.
export interface SalesFunnel {
  leadsWeek: number;
  sentWeek: number;
  repliesWeek: number;
  replyRatePct: number | null;
  hotOpen: number;
  demosWeek: number;
  autoSend: boolean;
  autoSentToday: number;
  autoSendCap: number;
  trustApprovedInARow: number;
}

export async function salesFunnel(db: Db, now: Date): Promise<SalesFunnel> {
  const week = dubaiWeekStartUtc(now);
  const count = async (q: Promise<Array<{ n: string }>>) => Number((await q)[0]?.n ?? 0);
  const leadsWeek = await count(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), gte(leads.createdAt, week))));
  const sentWeek = await count(db.select({ n: sql<string>`count(*)` }).from(outreach).where(and(eq(outreach.simulated, false), gte(outreach.sentAt, week))));
  const repliesWeek = await count(db.select({ n: sql<string>`count(*)` }).from(outreach).where(and(eq(outreach.simulated, false), gte(outreach.replyAt, week))));
  const hotOpen = await count(db.select({ n: sql<string>`count(*)` }).from(approvals).where(and(eq(approvals.type, "outreach_email"), eq(approvals.status, "pending"), eq(approvals.simulated, false), sql`${approvals.content} ->> 'hot' = 'true'`)));
  const demosWeek = await count(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "demo_booked"), gte(leads.updatedAt, week))));
  const autoSentToday = await count(db.select({ n: sql<string>`count(*)` }).from(approvals).where(and(eq(approvals.type, "outreach_email"), eq(approvals.simulated, false), eq(approvals.decidedVia, "auto"), gte(approvals.decidedAt, dubaiDayStartUtc(now)))));
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  return {
    leadsWeek,
    sentWeek,
    repliesWeek,
    replyRatePct: sentWeek ? Math.round((repliesWeek / sentWeek) * 1000) / 10 : null,
    hotOpen,
    demosWeek,
    autoSend: !!floor?.autoApprove,
    autoSentToday,
    autoSendCap: await autoSendCap(db),
    trustApprovedInARow: (await trustEarned(db)).approvedInARow,
  };
}
