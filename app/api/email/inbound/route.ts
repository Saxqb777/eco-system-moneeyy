import { getDb } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";
import { recordInboundReply, verifyWebhookSignature } from "@/lib/email";
import { json, unauthorized } from "@/lib/http";

export const dynamic = "force-dynamic";

// Resend webhook for received emails (Chaser's replies). Signed with the webhook secret from the clipboard.
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
  if (!event?.type || !String(event.type).startsWith("email.received")) return json({ ok: true, ignored: event?.type ?? "no type" });
  const from = Array.isArray(data.from) ? String(data.from[0] ?? "") : String(data.from ?? "");
  const subject = String(data.subject ?? "");
  let text = String(data.text ?? "");
  if (!text && typeof data.html === "string") text = data.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) text = `(no text in the webhook, email id ${String(data.email_id ?? data.id ?? "unknown")})`;
  const result = await recordInboundReply(db, { from, subject, text });
  return json({ ok: true, ...result });
}
