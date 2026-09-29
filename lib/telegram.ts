// Telegram: the owner's phone. Outbound goes through the messages_out queue, delivered by the tick, so a failed
// send is retried and never duplicated. Inbound comes through the webhook, only from the paired chat.
import { createHmac } from "node:crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, ideas, messagesOut, setupItems } from "@/db/schema";
import { getSettings, setSetting } from "@/lib/settings";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export interface TelegramConfig {
  token: string;
  chatId: string | null;
}

export type TelegramApi = (token: string, method: string, body: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; description?: string }>;

let api: TelegramApi = async (token, method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as { ok: boolean; result?: unknown; description?: string };
};

// Tests hand in a fake transport here.
export function setTelegramApi(fn: TelegramApi | null) {
  api = fn ?? api;
}

async function setupValue(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(setupItems).where(eq(setupItems.key, key)).limit(1);
  if (!row || row.status !== "present" || !row.valueEncrypted) return null;
  try {
    return decryptSecret(row.valueEncrypted);
  } catch {
    return null;
  }
}

export async function getTelegramConfig(db: Db): Promise<TelegramConfig | null> {
  const token = await setupValue(db, "telegram_bot_token");
  if (!token) return null;
  const chatId = await setupValue(db, "telegram_chat_id");
  return { token, chatId };
}

// Shown in the Setup tab. Sending "/pair <code>" to the bot pairs that chat as the owner's.
export function pairingCode(): string | null {
  const key = process.env.SECRETS_KEY;
  if (!key) return null;
  return createHmac("sha256", key).update("telegram-pair").digest("hex").slice(0, 6);
}

export async function pairChat(db: Db, chatId: string, now = new Date()) {
  await db
    .update(setupItems)
    .set({ status: "present", valueEncrypted: encryptSecret(chatId), hint: "paired from Telegram", providedAt: now })
    .where(eq(setupItems.key, "telegram_chat_id"));
}

export interface OutboundMessage {
  kind: string;
  body: string;
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
  relatedType?: string;
  relatedId?: string | null;
  sendAfter?: Date;
  now?: Date;
}

export async function enqueueMessage(db: Db, m: OutboundMessage): Promise<void> {
  const now = m.now ?? new Date();
  await db.insert(messagesOut).values({
    channel: "telegram",
    chatId: null,
    kind: m.kind,
    body: m.body.slice(0, 3900),
    inlineKeyboard: m.inlineKeyboard ?? null,
    relatedType: m.relatedType ?? null,
    relatedId: m.relatedId ?? null,
    status: "queued",
    sendAfter: m.sendAfter ?? now,
    createdAt: now,
  });
}

// The tick's deliver step. Bounded, idempotent: a row is marked sent before the next tick can see it again.
export async function deliverMessages(db: Db, now = new Date()): Promise<{ status: string; sent: number; failed: number; reason?: string }> {
  const cfg = await getTelegramConfig(db);
  if (!cfg) return { status: "skipped", sent: 0, failed: 0, reason: "Telegram bot token not on the clipboard" };
  if (!cfg.chatId) return { status: "skipped", sent: 0, failed: 0, reason: "No paired chat yet: send /pair <code> to the bot" };
  const due = await db
    .select()
    .from(messagesOut)
    .where(and(eq(messagesOut.status, "queued"), lte(messagesOut.sendAfter, now)))
    .orderBy(asc(messagesOut.sendAfter))
    .limit(20);
  let sent = 0;
  let failed = 0;
  for (const m of due) {
    const body: Record<string, unknown> = { chat_id: m.chatId ?? cfg.chatId, text: m.body, disable_web_page_preview: true };
    if (m.inlineKeyboard) body.reply_markup = { inline_keyboard: m.inlineKeyboard };
    let res: Awaited<ReturnType<TelegramApi>>;
    try {
      res = await api(cfg.token, "sendMessage", body);
    } catch (err) {
      res = { ok: false, description: err instanceof Error ? err.message : String(err) };
    }
    if (res.ok) {
      const messageId = (res.result as { message_id?: number } | undefined)?.message_id ?? null;
      await db.update(messagesOut).set({ status: "sent", sentAt: now, providerMessageId: messageId, attempts: m.attempts + 1 }).where(eq(messagesOut.id, m.id));
      if (m.relatedType === "approval" && m.relatedId && m.kind === "approval" && messageId) {
        await db.update(approvals).set({ telegramMessageId: messageId }).where(eq(approvals.id, m.relatedId));
      }
      if (m.relatedType === "idea" && m.relatedId && messageId) {
        await db.update(ideas).set({ telegramMessageId: messageId }).where(eq(ideas.id, m.relatedId));
      }
      sent += 1;
    } else {
      const attempts = m.attempts + 1;
      await db.update(messagesOut).set({ attempts, lastError: res.description ?? "send failed", status: attempts >= 5 ? "failed" : "queued", sendAfter: new Date(now.getTime() + 10 * 60 * 1000) }).where(eq(messagesOut.id, m.id));
      failed += 1;
    }
  }
  return { status: "ok", sent, failed };
}

// Direct replies from the webhook (an acknowledgement, a command answer). Failures are swallowed: the queue is the reliable path.
export async function sendNow(token: string, chatId: string, text: string, extra: Record<string, unknown> = {}): Promise<number | null> {
  try {
    const res = await api(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true, ...extra });
    return res.ok ? ((res.result as { message_id?: number } | undefined)?.message_id ?? null) : null;
  } catch {
    return null;
  }
}

export async function answerCallback(token: string, callbackId: string, text: string): Promise<void> {
  try {
    await api(token, "answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190) });
  } catch {
    // best effort
  }
}

export async function editMessage(token: string, chatId: string, messageId: number, text: string): Promise<void> {
  try {
    await api(token, "editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 3900), disable_web_page_preview: true });
  } catch {
    // best effort
  }
}

// Registers the webhook once per token and URL. Telegram then posts updates with the secret header.
export async function ensureWebhook(db: Db): Promise<{ status: string; reason?: string }> {
  const cfg = await getTelegramConfig(db);
  if (!cfg) return { status: "skipped", reason: "no bot token" };
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return { status: "skipped", reason: "TELEGRAM_WEBHOOK_SECRET is not set" };
  const base = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
  const url = `${base}/api/telegram`;
  const s = await getSettings(db);
  const current = s.telegram_webhook as { url?: string; token?: string } | null;
  const tokenHint = cfg.token.slice(-6);
  if (current?.url === url && current?.token === tokenHint) return { status: "ok" };
  try {
    const res = await api(cfg.token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
    if (!res.ok) return { status: "failed", reason: res.description ?? "setWebhook failed" };
    await setSetting(db, "telegram_webhook", { url, token: tokenHint, at: new Date().toISOString() });
    return { status: "registered" };
  } catch (err) {
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
}
