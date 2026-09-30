// The owner answers a lead himself from his phone: /send <company>: <text>. It goes out at once from the
// DocLedger address, in the same thread, and replaces any answer the Chaser drafted for that lead. Typing the
// command is the owner's approval, so the approval row is written as decided by him (via "owner").
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, leads, outreach, taskEvents } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { clipboardValue } from "@/lib/clipboard";
import { sendOutreach } from "@/lib/email";
import { withTickLock } from "@/warden/heartbeat";

export interface OwnerSendResult {
  ok: boolean;
  message: string;
}

// "Saaqib Khan <saaqib@docledger.site>" signs as "Saaqib Khan".
export function senderName(from: string | null): string {
  const m = (from ?? "").match(/^\s*"?([^"<]+?)"?\s*</);
  return m?.[1]?.trim() || "The DocLedger team";
}

export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "DocLedger";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

// Runs outside any tick, so a heartbeat can never send the same email a second time. Waits up to a minute.
export async function ownerSend(db: Db, company: string, text: string, now = new Date(), waitMs = 60_000): Promise<OwnerSendResult> {
  const r = await withTickLock(db, () => ownerSendNow(db, company, text, now), waitMs);
  return r.ran ? r.value : { ok: false, message: "The Tower is busy with a heartbeat. Nothing was sent: send it again in a minute." };
}

async function ownerSendNow(db: Db, company: string, text: string, now: Date): Promise<OwnerSendResult> {
  const needle = company.trim().toLowerCase();
  const body = text.trim();
  if (!needle || !body) return { ok: false, message: "Format: /send <company>: <your text>" };
  const matches = await db
    .select()
    .from(leads)
    .where(and(eq(leads.simulated, false), sql`lower(${leads.company}) like ${`%${needle}%`}`))
    .orderBy(desc(leads.updatedAt))
    .limit(5);
  const lead = matches.find((l) => l.company.toLowerCase() === needle) ?? matches[0];
  if (!lead) return { ok: false, message: `No lead matches "${company.trim()}". Check the name in the Mailbox tab.` };
  const dm = (lead.decisionMaker ?? {}) as { email?: string; name?: string };
  const to = (dm.email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, message: `${lead.company} has no email address yet, so nothing was sent.` };

  const thread = await db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(desc(outreach.step));
  const lastReal = thread.find((o) => o.status !== "draft" && o.status !== "rejected");
  // Answers the Chaser or Writer drafted for this lead are replaced by the owner's own words.
  const drafts = thread.filter((o) => o.status === "draft");
  const draftApprovalIds = drafts.map((o) => o.approvalId).filter((x): x is string => !!x);
  if (draftApprovalIds.length) {
    await db
      .update(approvals)
      .set({ status: "rejected", feedback: "The owner answered this lead himself", decidedAt: now, decidedVia: "owner", updatedAt: now })
      .where(and(inArray(approvals.id, draftApprovalIds), eq(approvals.status, "pending")));
  }
  if (drafts.length) await db.update(outreach).set({ status: "rejected", updatedAt: now }).where(inArray(outreach.id, drafts.map((o) => o.id)));

  const from = await clipboardValue(db, "resend_from");
  const address = await clipboardValue(db, "business_address");
  const signed = `${body}\n\n${senderName(from)}${address ? `\n${address}` : ""}`;
  const subject = replySubject(lastReal?.subject);
  const step = (thread[0]?.step ?? 0) + 1;
  const [row] = await db
    .insert(outreach)
    .values({ leadId: lead.id, step, channel: "email", subject, bodyText: signed, status: "draft", simulated: false, createdAt: now, updatedAt: now })
    .returning({ id: outreach.id });
  const { id: approvalId } = await raiseApproval(
    db,
    { type: "outreach_email", summary: `Your own reply to ${lead.company}`, content: { to, toName: dm.name ?? "", company: lead.company, subject, body: signed, outreachId: row?.id ?? null, step, ownerSent: true }, floorId: lead.floorId, autoApproved: true },
    now,
  );
  // Decided by the owner, not by the auto send rule: it does not count against the daily auto send cap.
  await db.update(approvals).set({ decidedVia: "owner" }).where(eq(approvals.id, approvalId));
  if (row) await db.update(outreach).set({ approvalId }).where(eq(outreach.id, row.id));
  const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  const sent = await sendOutreach(db, approval!, now, { anyHour: true });
  if (!sent.ok) {
    await db.update(approvals).set({ executionResult: { error: sent.error ?? "send failed" }, updatedAt: now }).where(eq(approvals.id, approvalId));
    return { ok: false, message: `Not sent: ${sent.error ?? "send failed"}. It stays approved and goes out on the next heartbeat.` };
  }
  await db.update(approvals).set({ executedAt: now, executionResult: { sent: true, by: "owner" }, updatedAt: now }).where(eq(approvals.id, approvalId));
  // Their last message is answered now, so the Chaser leaves it alone.
  const replied = thread.find((o) => o.status === "replied");
  if (replied) await db.update(outreach).set({ status: "answered", updatedAt: now }).where(eq(outreach.id, replied.id));
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "sent", message: `The owner wrote to ${lead.company} himself: ${subject}`, createdAt: now });
  return { ok: true, message: `Sent to ${dm.name ? `${dm.name} at ` : ""}${lead.company} (${to}): ${subject}` };
}
