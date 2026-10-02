import { getDb } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";
import { fetchReceivedEmail, htmlToText, recordEmailEvent, recordInboundReply, verifyWebhookSignature } from "@/lib/email";
import { json, unauthorized } from "@/lib/http";

export const dynamic = "force-dynamic";

const DELIVERY_EVENTS = ["email.delivered", "email.bounced", "email.complained", "email.delivery_delayed", "email.failed"];

// Resend webhook: replies (email.received) and delivery events for the emails we sent (D077).
// Signed with the webhook secret from the clipboard. One endpoint, every event type the webhook is given.
export async function POST(req: Request) {
  const db = getDb();
  const secret = await clipboardValue(db, "resend_webhook_secret");
  if (!secret) return unauthorized("Resend webhook secret not on the clipboard");
  const body = await req.text();
  const ok = verifyWebhookSignature(secret, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body);
  if (!ok) return unauthorized("Bad webhook signature");
  let event: { type?: string; data?: Record<string, unknown> } | null = null;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ ok: true, ignored: "not json" });
  }
  const data = event?.data ?? {};
  const type = String(event?.type ?? "");
  const now = new Date();
  const emailId = String(data.email_id ?? data.id ?? "");
  if (type.startsWith("email.received")) {
    let from = Array.isArray(data.from) ? String(data.from[0] ?? "") : String(data.from ?? "");
    let subject = String(data.subject ?? "");
    let text = String(data.text ?? "");
    if (!text.trim() && typeof data.html === "string") text = htmlToText(data.html);
    // The webhook names the email but carries no body: read it by id now, or hand it to the repair step.
    if (!text.trim() && emailId) {
      const got = await fetchReceivedEmail(db, emailId);
      if (got.ok) {
        text = got.text;
        from = from || got.from;
        subject = subject || got.subject;
      }
    }
    const result = await recordInboundReply(db, { from, subject, text, emailId: emailId || null, pending: !text.trim() }, now);
    return json({ ok: true, ...result });
  }
  if (DELIVERY_EVENTS.includes(type)) {
    const to = Array.isArray(data.to) ? String(data.to[0] ?? "") : String(data.to ?? "");
    const bounce = data.bounce && typeof data.bounce === "object" ? (data.bounce as { message?: string; type?: string; subType?: string }) : null;
    const result = await recordEmailEvent(db, { type, emailId, to, bounce }, now);
    return json({ ok: true, ...result });
  }
  return json({ ok: true, ignored: type || "no type" });
}
