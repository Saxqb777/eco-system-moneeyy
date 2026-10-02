// Email through Resend. Sending only ever happens from an approved outreach_email item.
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, leads, outreach, taskEvents, tasks } from "@/db/schema";
import { clipboardValue } from "@/lib/clipboard";
import { inBusinessHours } from "@/lib/markets";
import { getSetting, setSetting } from "@/lib/settings";
import { enqueueMessage } from "@/lib/telegram";
import { dubaiParts } from "@/lib/time";

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
// anyHour: the owner wrote this one himself and pressed send, so it goes now, whatever the hour is where they are.
// skipped: nothing went out and nothing will (a second first email for the same company, or an address on the stop list);
// the approval still counts as executed so it never comes round again.
export type SendResult = { ok: boolean; error?: string; skipped?: string };

// Outreach rows that mean "this company already got its first email".
const EMAILED_STATES = ["sent", "replied", "reply_pending", "handling", "answered", "bounced", "complained"];

export async function sendOutreach(db: Db, a: typeof approvals.$inferSelect, now = new Date(), opts: { anyHour?: boolean } = {}): Promise<SendResult> {
  if (a.status !== "approved") return { ok: false, error: "not approved" };
  const content = (a.content ?? {}) as Record<string, unknown>;
  const outreachId = typeof content.outreachId === "string" ? content.outreachId : null;
  const [row] = outreachId ? await db.select().from(outreach).where(eq(outreach.id, outreachId)).limit(1) : await db.select().from(outreach).where(eq(outreach.approvalId, a.id)).limit(1);
  if (!row) return { ok: false, error: "outreach row missing" };
  if (row.status === "sent") return { ok: true, skipped: "already sent" };
  if (row.status === "duplicate" || row.status === "stopped") return { ok: true, skipped: row.status };
  const to = String(content.to ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { ok: false, error: "no email address for the contact" };
  // D077: they asked us to stop (a reply, a spam complaint, a hard bounce): nothing goes to that address again.
  if (await isSuppressed(db, to)) {
    await db.update(outreach).set({ status: "stopped", updatedAt: now }).where(eq(outreach.id, row.id));
    return { ok: true, skipped: `${to} is on the stop list` };
  }
  // D077: one first email per company. A redraft that was approved after the first one went out is dropped here.
  if (row.step === 1 && row.leadId) {
    const [other] = await db
      .select({ id: outreach.id })
      .from(outreach)
      .where(and(eq(outreach.leadId, row.leadId), eq(outreach.step, 1), eq(outreach.simulated, false), ne(outreach.id, row.id), inArray(outreach.status, EMAILED_STATES)))
      .limit(1);
    if (other) {
      await db.update(outreach).set({ status: "duplicate", updatedAt: now }).where(eq(outreach.id, row.id));
      return { ok: true, skipped: "this company already had its first email" };
    }
  }
  // Worldwide: an email lands in the reader's working hours, never at night or on their weekend.
  const [lead] = row.leadId ? await db.select({ country: leads.country }).from(leads).where(eq(leads.id, row.leadId)).limit(1) : [];
  if (!opts.anyHour && lead?.country && !inBusinessHours(lead.country, now)) return { ok: false, error: `waiting for business hours in ${lead.country}` };
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

// The first lines of a reply that mean "do not write again". Handled by code, never by the Chaser (D077).
const STOP_WORDS = /^(please\s+)?(stop|unsubscribe|remove (me|us)|take (me|us) off|no thanks|no thank you|not interested|do not (email|contact|write)|don'?t (email|contact|write))\b/i;

export function isStopReply(text: string): boolean {
  const first = stripQuoted(text).split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return STOP_WORDS.test(first.slice(0, 120));
}

// Cuts the quoted history off a reply ("On Tue, X wrote:", "-----Original Message-----", "From: ... Sent: ...").
export function stripQuoted(text: string): string {
  const markers = [/^On .{5,160}?wrote:\s*$/m, /^-{2,}\s*Original Message\s*-{2,}/im, /^From:\s.+\r?\n(Sent|Date):\s/m, /^_{6,}\s*$/m, /^>\s?On .{5,160}?wrote:/m];
  let cut = text.length;
  for (const m of markers) {
    const i = text.search(m);
    if (i > 0 && i < cut) cut = i;
  }
  // A block of quoted lines at the end goes too.
  const lines = text.slice(0, cut).split(/\r?\n/);
  while (lines.length && (lines[lines.length - 1]!.trim() === "" || lines[lines.length - 1]!.startsWith(">"))) lines.pop();
  const out = lines.join("\n").trim();
  return out || text.trim();
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// The stop list: addresses that asked us to stop, complained, or bounced for good. settings.email_suppressed.
interface Suppressed {
  email: string;
  why: string;
  at: string;
}

export async function suppressedList(db: Db): Promise<Suppressed[]> {
  const v = await getSetting<unknown>(db, "email_suppressed", []);
  return Array.isArray(v) ? (v as Suppressed[]).filter((x) => x && typeof x.email === "string") : [];
}

export async function isSuppressed(db: Db, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  return (await suppressedList(db)).some((x) => x.email === e);
}

export async function suppressEmail(db: Db, email: string, why: string, now: Date): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!e) return;
  const list = await suppressedList(db);
  if (list.some((x) => x.email === e)) return;
  list.push({ email: e, why, at: now.toISOString() });
  await setSetting(db, "email_suppressed", list.slice(-2000));
}

// D077: Resend's email.received webhook names the email but carries no body. The Tower reads the body by id.
// A sending only key is refused here (401): the owner pastes a Full access key.
export type ReceivedEmail = { ok: true; text: string; from: string; subject: string } | { ok: false; error: string; permission?: boolean };

export async function fetchReceivedEmail(db: Db, emailId: string): Promise<ReceivedEmail> {
  const key = await clipboardValue(db, "resend_api_key");
  if (!key) return { ok: false, error: "Resend API key not on the clipboard" };
  if (!/^[0-9a-z][0-9a-z-]{2,60}$/i.test(emailId)) return { ok: false, error: "bad email id" };
  const res = await transport(key, `/emails/receiving/${emailId}`, "GET");
  if (res.status === 401 || res.status === 403) return { ok: false, error: "the Resend key cannot read received emails: it needs Full access", permission: true };
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${String(res.json?.message ?? res.json?.error ?? "could not read the email")}` };
  const j = res.json ?? {};
  let text = typeof j.text === "string" ? j.text : "";
  if (!text.trim() && typeof j.html === "string") text = htmlToText(j.html);
  const from = Array.isArray(j.from) ? String(j.from[0] ?? "") : String(j.from ?? "");
  return { ok: true, text: text.trim(), from, subject: String(j.subject ?? "") };
}

const PLACEHOLDER = /^\(no text in the webhook, email id ([0-9a-z][0-9a-z-]{2,60})\)/i;

export interface InboundReply {
  from: string;
  subject: string;
  text: string;
  company?: string;
  emailId?: string | null;
  // The webhook had no body and the fetch did not work yet: the row waits as reply_pending for the repair step.
  pending?: boolean;
}

// A reply, from the inbound webhook or forwarded by hand: matched to the latest sent email of that lead.
export async function recordInboundReply(db: Db, r: InboundReply, now = new Date()): Promise<{ matched: boolean; leadId?: string; company?: string; pending?: boolean; stopped?: boolean }> {
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
    const shown = r.pending ? "(the text is read on the next heartbeat)" : r.text.slice(0, 600);
    await enqueueMessage(db, { kind: "reply_unmatched", body: `A reply arrived that I could not match to a lead.\nFrom: ${r.from}\nSubject: ${r.subject}\n\n${shown}\n\nForward it with: /reply <company>: <their text>`, now });
    return { matched: false };
  }
  const [last] = await db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(desc(outreach.step)).limit(1);
  const emailId = r.emailId ?? null;
  if (r.pending) {
    // Body not read yet: the thread shows "reading it", the Chaser waits, repairBlankReplies finishes the job.
    const placeholder = `(no text in the webhook, email id ${emailId ?? "unknown"})`;
    if (last) await db.update(outreach).set({ status: "reply_pending", replyText: placeholder, replyAt: now, replyEmailId: emailId, updatedAt: now }).where(eq(outreach.id, last.id));
    else await db.insert(outreach).values({ leadId: lead.id, step: 0, channel: "email", subject: r.subject, bodyText: "", status: "reply_pending", replyText: placeholder, replyAt: now, replyEmailId: emailId, simulated: false, createdAt: now, updatedAt: now });
    await db.update(leads).set({ status: "replied", updatedAt: now }).where(eq(leads.id, lead.id));
    await db.insert(taskEvents).values({ floorId: lead.floorId, type: "reply", message: `Reply from ${lead.company} arrived, reading it`, createdAt: now });
    await enqueueMessage(db, { kind: "reply", body: `Reply from ${lead.company} (${r.from}) arrived. I read the text on the next heartbeat and send it to you.`, now });
    return { matched: true, leadId: lead.id, company: lead.company, pending: true };
  }
  const text = stripQuoted(r.text).slice(0, 4000) || "(empty reply)";
  if (isStopReply(text)) {
    await stopLead(db, lead, last ?? null, text, fromEmail || (typeof (lead.decisionMaker as Record<string, unknown> | null)?.email === "string" ? String((lead.decisionMaker as Record<string, unknown>).email) : ""), "asked us to stop", now);
    return { matched: true, leadId: lead.id, company: lead.company, stopped: true };
  }
  if (last) {
    await db.update(outreach).set({ status: "replied", replyText: text, replyAt: now, replyEmailId: emailId, updatedAt: now }).where(eq(outreach.id, last.id));
  } else {
    await db.insert(outreach).values({ leadId: lead.id, step: 0, channel: "email", subject: r.subject, bodyText: "", status: "replied", replyText: text, replyAt: now, replyEmailId: emailId, simulated: false, createdAt: now, updatedAt: now });
  }
  await db.update(leads).set({ status: "replied", updatedAt: now }).where(eq(leads.id, lead.id));
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "reply", message: `Reply from ${lead.company}: ${r.subject || text.slice(0, 60)}`, createdAt: now });
  await enqueueMessage(db, { kind: "reply", body: `Reply from ${lead.company} (${r.from}):\n${text.slice(0, 800)}\n\nChaser picks it up on the next heartbeat.`, now });
  return { matched: true, leadId: lead.id, company: lead.company };
}

// They said stop: the thread closes, the address goes on the stop list, the owner hears it once. No Chaser.
async function stopLead(db: Db, lead: typeof leads.$inferSelect, last: typeof outreach.$inferSelect | null, text: string, email: string, why: string, now: Date): Promise<void> {
  if (last) await db.update(outreach).set({ status: "answered", replyText: text, replyAt: last.replyAt ?? now, updatedAt: now }).where(eq(outreach.id, last.id));
  await db.update(leads).set({ status: "lost", updatedAt: now }).where(eq(leads.id, lead.id));
  if (email) await suppressEmail(db, email, why, now);
  // A Chaser task that was waiting on this thread has nothing left to do.
  if (last) await db.update(tasks).set({ status: "done", output: { note: `${lead.company} ${why}` }, finishedAt: now, updatedAt: now }).where(and(eq(tasks.kind, "follow_up"), inArray(tasks.status, ["queued", "blocked"]), sql`${tasks.input} ->> 'outreachId' = ${last.id}`));
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "reply", message: `${lead.company} ${why}: thread closed`, createdAt: now });
  await enqueueMessage(db, { kind: "reply", body: `${lead.company} ${why}: "${text.slice(0, 200)}". Done, they will not hear from us again.`, now });
}

// D077: replies whose body the webhook did not carry. Read them by id, then the Chaser can work.
// A sending only key cannot read them: the owner is told once a day what to paste.
export async function repairBlankReplies(db: Db, now = new Date()): Promise<{ repaired: number; waiting: number; permission: boolean }> {
  const rows = await db
    .select()
    .from(outreach)
    .where(and(eq(outreach.simulated, false), or(eq(outreach.status, "reply_pending"), and(inArray(outreach.status, ["replied", "handling"]), sql`${outreach.replyText} like '(no text in the webhook, email id %'`))))
    .limit(10);
  let repaired = 0;
  let permission = false;
  for (const row of rows) {
    const id = row.replyEmailId ?? row.replyText?.match(PLACEHOLDER)?.[1] ?? null;
    if (!id) continue;
    const got = await fetchReceivedEmail(db, id);
    if (!got.ok) {
      if (got.permission) permission = true;
      continue;
    }
    const [lead] = row.leadId ? await db.select().from(leads).where(eq(leads.id, row.leadId)).limit(1) : [];
    const text = stripQuoted(got.text).slice(0, 4000) || "(empty reply)";
    // A Chaser task that was blocked on this thread is replaced: the pipeline queues a fresh one for the replied row.
    await db.update(tasks).set({ status: "done", output: { note: "replaced once the reply text was read" }, finishedAt: now, updatedAt: now }).where(and(eq(tasks.kind, "follow_up"), inArray(tasks.status, ["queued", "blocked"]), sql`${tasks.input} ->> 'outreachId' = ${row.id}`));
    if (lead && isStopReply(text)) {
      await stopLead(db, lead, row, text, (got.from.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? "").toLowerCase(), "asked us to stop", now);
      repaired += 1;
      continue;
    }
    await db.update(outreach).set({ status: "replied", replyText: text, replyEmailId: id, updatedAt: now }).where(eq(outreach.id, row.id));
    if (lead) {
      await db.insert(taskEvents).values({ floorId: lead.floorId, type: "reply", message: `Reply from ${lead.company}: ${text.slice(0, 60)}`, createdAt: now });
      await enqueueMessage(db, { kind: "reply", body: `Reply from ${lead.company} (${got.from || "their address"}):\n${text.slice(0, 800)}\n\nChaser picks it up on the next heartbeat.`, now });
    }
    repaired += 1;
  }
  const waiting = rows.length - repaired;
  if (permission) {
    const day = dubaiParts(now).dayKey;
    if ((await getSetting<string | null>(db, "resend_read_hint_day", null)) !== day) {
      await setSetting(db, "resend_read_hint_day", day);
      await enqueueMessage(db, { kind: "setup", body: `${waiting} repl${waiting === 1 ? "y" : "ies"} arrived that I cannot read: the Resend key is sending only. At resend.com open API Keys, Create, permission Full access, and paste it over the "Resend API key" box in Setup. I read the waiting replies on the next heartbeat.`, now });
    }
  }
  return { repaired, waiting, permission };
}

// D077: delivery events from Resend (delivered, bounced, complained, delayed, failed), matched by the email id.
export interface EmailEvent {
  type: string;
  emailId: string;
  to?: string | null;
  bounce?: { message?: string; type?: string; subType?: string } | null;
}

export async function recordEmailEvent(db: Db, ev: EmailEvent, now = new Date()): Promise<{ matched: boolean; outcome?: string }> {
  if (!ev.emailId) return { matched: false };
  const [row] = await db.select().from(outreach).where(and(eq(outreach.resendId, ev.emailId), eq(outreach.simulated, false))).limit(1);
  if (!row) return { matched: false };
  const [lead] = row.leadId ? await db.select().from(leads).where(eq(leads.id, row.leadId)).limit(1) : [];
  const company = lead?.company ?? "a company";
  const kind = ev.type.replace(/^email\./, "");
  if (kind === "delivered") {
    if (!row.deliveredAt) await db.update(outreach).set({ deliveredAt: now, updatedAt: now }).where(eq(outreach.id, row.id));
    return { matched: true, outcome: "delivered" };
  }
  if (kind === "delivery_delayed") {
    await db.insert(taskEvents).values({ floorId: lead?.floorId ?? null, type: "delayed", message: `Email to ${company} is delayed`, createdAt: now });
    return { matched: true, outcome: "delayed" };
  }
  if (kind === "bounced" || kind === "failed") {
    const reason = String(ev.bounce?.message ?? ev.bounce?.subType ?? kind).slice(0, 300);
    await db.update(outreach).set({ status: "bounced", bounceReason: reason, updatedAt: now }).where(eq(outreach.id, row.id));
    const hard = kind === "failed" || /permanent/i.test(String(ev.bounce?.type ?? "")) || /general|noemail|suppressed|onaccountsuppressionlist|invalid/i.test(String(ev.bounce?.subType ?? ""));
    if (lead && !["client", "trial", "lost", "demo_booked"].includes(lead.status)) await db.update(leads).set({ status: "bounced", updatedAt: now }).where(eq(leads.id, lead.id));
    if (hard && ev.to) await suppressEmail(db, ev.to, "bounced", now);
    await db.insert(taskEvents).values({ floorId: lead?.floorId ?? null, type: "bounced", message: `Email to ${company} bounced: ${reason}`, createdAt: now });
    return { matched: true, outcome: "bounced" };
  }
  if (kind === "complained") {
    await db.update(outreach).set({ status: "complained", updatedAt: now }).where(eq(outreach.id, row.id));
    if (lead) await db.update(leads).set({ status: "lost", updatedAt: now }).where(eq(leads.id, lead.id));
    if (ev.to) await suppressEmail(db, ev.to, "complained", now);
    await db.insert(taskEvents).values({ floorId: lead?.floorId ?? null, type: "complaint", message: `${company} marked our email as spam`, createdAt: now });
    await enqueueMessage(db, { kind: "reply", body: `${company} marked our email as spam. The address is on the stop list and the thread is closed.`, now });
    return { matched: true, outcome: "complained" };
  }
  return { matched: true, outcome: "ignored" };
}
