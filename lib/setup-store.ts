// The clipboard's one write path (D082). The Setup tab saves through here, and so does any approval note that
// turns out to hold a key: validation per box, AES at rest, a short hint, never the value back to a browser.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, setupItems, taskEvents } from "@/db/schema";
import { encryptSecret, secretHint } from "@/lib/crypto";
import { parseAlpacaKeys } from "@/lib/market";
import { parseFacebookPage, parseXCredentials } from "@/lib/social";
import { channelChatId, enqueueMessage } from "@/lib/telegram";

type Item = Pick<typeof setupItems.$inferSelect, "key" | "kind">;

export type SaveResult = { ok: true; key: string; label: string; hint: string } | { ok: false; error: string };

// The rules each box has always had, in one place.
export function validateSetupValue(item: Item, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  let value = raw.trim();
  if (!value) return { ok: false, error: "value is empty" };
  if (item.key === "x_credentials" && !parseXCredentials(value)) return { ok: false, error: "Paste four values separated by spaces: API Key, API Key Secret, Access Token, Access Token Secret." };
  if ((item.key === "facebook_page" || item.key === "docledger_facebook_page") && !parseFacebookPage(value)) return { ok: false, error: "Paste the Page ID (numbers) and the Page access token, separated by a space." };
  if (item.key === "alpaca_keys" && !parseAlpacaKeys(value)) return { ok: false, error: "Paste the API Key ID and the Secret Key separated by a space." };
  if (item.key === "deals_channel") {
    const clean = channelChatId(value);
    if (!clean) return { ok: false, error: "Paste the channel handle like @uaedailydeals (or its t.me link)." };
    value = clean;
  }
  if (item.kind === "url" && !/^https?:\/\//.test(value)) return { ok: false, error: "Expected a URL starting with http" };
  if (item.key === "telegram_chat_id" && !/^-?\d{5,20}$/.test(value)) return { ok: false, error: "A chat id is a number. Easiest: open your bot in Telegram and send the /pair line shown here." };
  return { ok: true, value };
}

export async function saveSetupValue(db: Db, key: string, raw: string, now = new Date()): Promise<SaveResult> {
  const [item] = await db.select().from(setupItems).where(eq(setupItems.key, key)).limit(1);
  if (!item) return { ok: false, error: "Unknown setup item" };
  const v = validateSetupValue(item, raw);
  if (!v.ok) return v;
  const hint = item.kind === "secret" ? secretHint(v.value) : v.value.length > 80 ? `${v.value.slice(0, 77)}...` : v.value;
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(v.value), hint, providedAt: now }).where(eq(setupItems.key, item.key));
  return { ok: true, key: item.key, label: item.label, hint };
}

// What a pasted key looks like and which box it belongs in. Specific shapes first.
const SHAPES: Array<{ key: string; re: RegExp }> = [
  { key: "anthropic_api_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { key: "telegram_bot_token", re: /\b\d{6,12}:[A-Za-z0-9_-]{30,}/ },
  { key: "resend_api_key", re: /\bre_[A-Za-z0-9_]{16,}/ },
  { key: "resend_webhook_secret", re: /\bwhsec_[A-Za-z0-9+/=_-]{16,}/ },
  { key: "docledger_github_token", re: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/ },
  // the Page ID and the token together, as the box wants them
  { key: "docledger_facebook_page", re: /\b\d{5,25}\s+EAA[A-Za-z0-9]{40,}/ },
  // the token alone: the box also needs the Page ID
  { key: "docledger_facebook_page", re: /\bEAA[A-Za-z0-9]{40,}/ },
  { key: "alpaca_keys", re: /\b[AP]K[A-Z0-9]{14,}\s+[A-Za-z0-9/+_-]{30,}/ },
];
// Anything else that reads like a key: one long run of letters and digits, no spaces, not a URL and not an id.
const GENERIC = /(?<![\w/.:@-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![\w/.:@-])/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DetectedSecret {
  // the Setup box this shape belongs in, null when the shape is unknown
  key: string | null;
  value: string;
  // false when the box needs more than what was typed (a Facebook token without its Page ID)
  complete: boolean;
}

export function detectSecret(text: string | null | undefined): DetectedSecret | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  for (const s of SHAPES) {
    const m = t.match(s.re);
    if (m) {
      const value = m[0].trim();
      return { key: s.key, value, complete: !(s.key === "docledger_facebook_page" && !/^\d/.test(value)) };
    }
  }
  const g = t.match(GENERIC);
  if (g && !UUID.test(g[0]) && !/^https?:\/\//i.test(t)) return { key: null, value: g[0], complete: false };
  return null;
}

export interface NoteGuard {
  // the note as it may be stored
  feedback: string | null;
  moved: { key: string; label: string } | null;
  dropped: boolean;
}

// D082: a key typed into an approval note never stays in the approvals table, never rides into a task's input, a
// Telegram echo or a model prompt. It moves into its Setup box, encrypted, and the note keeps a plain marker.
export async function quarantineNote(db: Db, a: Pick<typeof approvals.$inferSelect, "id" | "summary" | "content" | "taskId" | "agentId" | "floorId">, note: string | null, now = new Date()): Promise<NoteGuard> {
  const found = detectSecret(note);
  if (!found) return { feedback: note, moved: null, dropped: false };
  const content = (a.content ?? {}) as Record<string, unknown>;
  // Warden names the box it asked for; a known shape wins over that, an unknown shape falls back to it.
  const asked = typeof content.setupKey === "string" && content.setupKey ? content.setupKey : null;
  const key = found.key ?? asked;
  let saved: SaveResult = { ok: false, error: "no Setup box matches this shape" };
  if (key && (found.complete || !found.key)) saved = await saveSetupValue(db, key, found.value, now);
  else if (key && !found.complete) saved = { ok: false, error: "the box needs the Page ID and the token together" };
  const label = saved.ok ? saved.label : key ? ((await db.select({ label: setupItems.label }).from(setupItems).where(eq(setupItems.key, key)).limit(1))[0]?.label ?? key) : null;
  const marker = saved.ok
    ? `(a key was typed here. It moved to the Setup box "${saved.label}" and was removed from this note)`
    : `(a secret was typed here and removed. It was not saved: ${saved.error}. Paste it in the Setup tab${label ? `, box "${label}"` : ""})`;
  const body = saved.ok
    ? `Your note on "${a.summary}" held a key. I saved it in the Setup box "${saved.label}" (${saved.hint}) and removed it from the note. Next time paste straight into Setup: notes are stored in plain text.`
    : `Your note on "${a.summary}" held a secret. I removed it from the note and could not save it (${saved.error}). Paste it in the Setup tab${label ? `, box "${label}"` : ""}.`;
  await enqueueMessage(db, { kind: "setup", body, relatedType: "approval", relatedId: a.id, now });
  await db.insert(taskEvents).values({ taskId: a.taskId ?? null, agentId: a.agentId ?? null, floorId: a.floorId ?? null, type: "log", message: saved.ok ? `The owner's note held a key: moved to Setup (${saved.label})` : "The owner's note held a secret: removed, not saved", createdAt: now });
  return { feedback: marker, moved: saved.ok ? { key: saved.key, label: saved.label } : null, dropped: !saved.ok };
}
