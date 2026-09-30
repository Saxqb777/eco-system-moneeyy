// Email through Resend. Sending only ever happens from an approved outreach_email item.
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, leads, outreach, taskEvents } from "@/db/schema";
import { clipboardValue } from "@/lib/clipboard";
import { enqueueMessage } from "@/lib/telegram";

export type EmailTransport = (key: string, path: string, method: "GET" | "POST", body?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }>;

let transport: EmailTransport = async (key, path, method, body) => {
  const res = await fetch(`https://api.resend.com${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, json };
};

export function setEmailTransport(fn: EmailTransport | null) {
  transport = fn ?? transport;
}

export async function sendEmail(db: Db, m: { to: string; subject: string; text: string; replyTo?: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = await clipboardValue(db, "resend_api_key");
  const from = await clipboardValue(db, "resend_from");
  if (!key) return { ok: false, error: "Resend API key not on the clipboard" };
  if (!from) return { ok: false, error: "Sending address not on the clipboard" };
  const res = await transport(key, "/emails", "POST", { from, to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${String(res.json?.message ?? res.json?.error ?? "send failed")}` };
  return { ok: true, id: String(res.json?.id ?? "") };
}

// Runs the side effect of an approved outreach_email item: exactly one send per outreach row.
export async function sendOutreach(db: Db, a: typeof approvals.$inferSelect, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  if (a.status !== "approved") return { ok: false, error: "not approved" };
  const content = (a.content ?? {}) as Record<string, unknown>;
  const outreachId = typeof content.outreachId === "string" ? content.outreachId : null;
  const [row] = outreachId ? await db.select().from(outreach).where(eq(outreach.id, outreachId)).limit(1) : await db.select().from(outreach).where(eq(outreach.approvalId, a.id)).limit(1);
  if (!row) return { ok: false, error: "outreach row missing" };
  if (row.status === "sent") return { ok: true };
  const to = String(content.to ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: "no email address for the contact" };
  const sent = await sendEmail(db, { to, subject: row.subject ?? String(content.subject ?? ""), text: row.bodyText ?? String(content.body ?? "") });
  if (!sent.ok) return sent;
  await db.update(outreach).set({ status: "sent", resendId: sent.id ?? null, sentAt: now, updatedAt: now }).where(eq(outreach.id, row.id));
  if (row.leadId) await db.update(leads).set({ status: "contacted", updatedAt: now }).where(and(eq(leads.id, row.leadId), sql`${leads.status} in ('drafted', 'qualified', 'contacted', 'replied')`));
  await db.insert(taskEvents).values({ taskId: a.taskId, agentId: a.agentId, floorId: a.floorId, type: "sent", message: `Email sent to ${to}: ${row.subject ?? ""}`, createdAt: now });
  return { ok: true };
}

// Svix style signature used by Resend webhooks: v1,<base64 hmac of "id.timestamp.body">.
export function verifyWebhookSignature(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = new Date()): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > 5 * 60) return false;
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(raw, "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  for (const part of headers.signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

// A reply, from the inbound webhook or forwarded by hand: matched to the latest sent email of that lead.
export async function recordInboundReply(db: Db, r: { from: string; subject: string; text: string; company?: string }, now = new Date()): Promise<{ matched: boolean; leadId?: string; company?: string }> {
  const fromEmail = (r.from.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? "").toLowerCase();
  const fromDomain = fromEmail.split("@")[1] ?? "";
  let lead: typeof leads.$inferSelect | undefined;
  if (fromEmail) {
    [lead] = await db.select().from(leads).where(and(eq(leads.simulated, false), sql`lower(${leads.decisionMaker} ->> 'email') = ${fromEmail}`)).limit(1);
  }
  if (!lead && fromDomain && !["gmail.com", "outlook.com", "hotmail.com", "yahoo.com"].includes(fromDomain)) {
    [lead] = await db.select().from(leads).where(and(eq(leads.simulated, false), sql`lower(coalesce(${leads.website}, '')) like ${`%${fromDomain}%`}`)).limit(1);
  }
  if (!lead && r.company) {
    [lead] = await db.select().from(leads).where(and(eq(leads.simulated, false), sql`lower(${leads.company}) like ${`%${r.company.toLowerCase()}%`}`)).limit(1);
  }
  if (!lead) {
    await enqueueMessage(db, { kind: "reply_unmatched", body: `A reply arrived that I could not match to a lead.\nFrom: ${r.from}\nSubject: ${r.subject}\n\n${r.text.slice(0, 600)}\n\nForward it with: /reply <company>: <their text>`, now });
    return { matched: false };
  }
  const [last] = await db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(desc(outreach.step)).limit(1);
  if (last) {
    await db.update(outreach).set({ status: "replied", replyText: r.text.slice(0, 4000), replyAt: now, updatedAt: now }).where(eq(outreach.id, last.id));
  } else {
    await db.insert(outreach).values({ leadId: lead.id, step: 0, channel: "email", subject: r.subject, bodyText: "", status: "replied", replyText: r.text.slice(0, 4000), replyAt: now, simulated: false, createdAt: now, updatedAt: now });
  }
  await db.update(leads).set({ status: "replied", updatedAt: now }).where(eq(leads.id, lead.id));
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "reply", message: `Reply from ${lead.company}: ${r.subject || r.text.slice(0, 60)}`, createdAt: now });
  await enqueueMessage(db, { kind: "reply", body: `Reply from ${lead.company} (${r.from}):\n${r.text.slice(0, 800)}\n\nChaser picks it up on the next heartbeat.`, now });
  return { matched: true, leadId: lead.id, company: lead.company };
}
