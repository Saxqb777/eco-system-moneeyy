// Deals channel health: member count over time, whether the bot can post, and the chats the owner added the bot to.
// Growth is what the Deals floor lives on, so Warden, the brief and the Editor all read from here.
import type { Db } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";
import { getSettings, setSetting, type SettingsMap } from "@/lib/settings";
import { channelChatId, enqueueMessage, getTelegramConfig, telegramCall } from "@/lib/telegram";
import { dubaiParts } from "@/lib/time";

export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const REFRESH_MS = 3 * 3600 * 1000;
const HISTORY_DAYS = 60;

export interface BotChat {
  id: string;
  title: string;
  type: string;
  username: string | null;
  status: string;
  canPost: boolean;
  addedByOwner: boolean;
  at: string;
}

export interface ChannelHealth {
  members: number | null;
  growthDay: number | null;
  growthWeek: number | null;
  botStatus: string | null;
  botCanPost: boolean | null;
  checkedAt: string | null;
}

export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  return new Date(d.getTime() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function history(s: SettingsMap): Record<string, number> {
  const h = s.channel_history;
  return h && typeof h === "object" ? (h as Record<string, number>) : {};
}

// Growth against yesterday and against the oldest reading in the last seven days.
export function channelHealthFrom(s: SettingsMap, dayKey: string): ChannelHealth {
  const h = history(s);
  const members = typeof s.channel_subscribers === "number" ? s.channel_subscribers : null;
  const yesterday = h[addDays(dayKey, -1)];
  let weekBase: number | null = null;
  for (let i = 7; i >= 1; i -= 1) {
    const v = h[addDays(dayKey, -i)];
    if (typeof v === "number") {
      weekBase = v;
      break;
    }
  }
  const bot = (s.channel_bot ?? null) as { status?: string; canPost?: boolean; checkedAt?: string } | null;
  return {
    members,
    growthDay: members !== null && typeof yesterday === "number" ? members - yesterday : null,
    growthWeek: members !== null && weekBase !== null ? members - weekBase : null,
    botStatus: bot?.status ?? null,
    botCanPost: typeof bot?.canPost === "boolean" ? bot.canPost : null,
    checkedAt: typeof s.channel_checked_at === "string" ? s.channel_checked_at : null,
  };
}

async function botIdentity(db: Db, token: string, s: SettingsMap): Promise<{ id: number; username: string | null } | null> {
  const known = s.telegram_bot as { id?: number; username?: string } | null;
  if (known?.id) return { id: known.id, username: known.username ?? null };
  const me = await telegramCall(token, "getMe", {});
  const r = (me.result ?? {}) as { id?: number; username?: string };
  if (!me.ok || typeof r.id !== "number") return null;
  await setSetting(db, "telegram_bot", { id: r.id, username: r.username ?? null });
  return { id: r.id, username: r.username ?? null };
}

// Every three hours: member count (kept per Dubai day for growth), and the bot's rights in the channel.
export async function refreshChannelSubscribers(db: Db, now = new Date()): Promise<{ status: string; count?: number; botCanPost?: boolean | null }> {
  const s = await getSettings(db);
  const last = typeof s.channel_checked_at === "string" ? Date.parse(s.channel_checked_at) : 0;
  if (Number.isFinite(last) && now.getTime() - last < REFRESH_MS) return { status: "fresh" };
  const channel = channelChatId(await clipboardValue(db, "deals_channel"));
  const cfg = await getTelegramConfig(db);
  if (!channel || !cfg) return { status: "skipped" };
  const p = dubaiParts(now);
  const res = await telegramCall(cfg.token, "getChatMemberCount", { chat_id: channel });
  if (!res.ok || typeof res.result !== "number") return { status: "failed" };
  const count = res.result;
  const h = history(s);
  h[p.dayKey] = count;
  const keep = Object.keys(h).sort().slice(-HISTORY_DAYS);
  await setSetting(db, "channel_history", Object.fromEntries(keep.map((k) => [k, h[k]])));
  await setSetting(db, "channel_subscribers", count);
  await setSetting(db, "channel_subscribers_day", p.dayKey);
  await setSetting(db, "channel_checked_at", now.toISOString());

  let botCanPost: boolean | null = null;
  const me = await botIdentity(db, cfg.token, s);
  if (me) {
    const m = await telegramCall(cfg.token, "getChatMember", { chat_id: channel, user_id: me.id });
    const r = (m.result ?? {}) as { status?: string; can_post_messages?: boolean };
    if (m.ok && r.status) {
      botCanPost = r.status === "administrator" && r.can_post_messages !== false;
      await setSetting(db, "channel_bot", { status: r.status, canPost: botCanPost, checkedAt: now.toISOString() });
    } else {
      botCanPost = false;
      await setSetting(db, "channel_bot", { status: "not in channel", canPost: false, checkedAt: now.toISOString() });
    }
  }
  return { status: "updated", count, botCanPost };
}

export interface ChatMemberUpdate {
  chat: { id: number | string; title?: string; type: string; username?: string };
  from: { id: number | string };
  new_chat_member: { status: string; can_post_messages?: boolean; user?: { id: number | string } };
}

export function botChats(s: SettingsMap): BotChat[] {
  const m = s.bot_chats;
  return m && typeof m === "object" ? Object.values(m as Record<string, BotChat>) : [];
}

// Chats the owner added the bot to, where it may post a share message (never the deals channel itself).
export function postableShareChats(s: SettingsMap, dealsChannel: string | null): BotChat[] {
  const own = (dealsChannel ?? "").replace(/^@/, "").toLowerCase();
  return botChats(s).filter((c) => c.addedByOwner && c.canPost && !(own && (c.username ?? "").toLowerCase() === own));
}

// Telegram tells us when the bot is added to or removed from a chat. Only chats the owner added count.
export async function recordBotChat(db: Db, u: ChatMemberUpdate, ownerChatId: string | null, now = new Date()): Promise<BotChat> {
  const s = await getSettings(db);
  const status = u.new_chat_member.status;
  const inChat = status === "member" || status === "administrator";
  const canPost = u.chat.type === "channel" ? status === "administrator" && u.new_chat_member.can_post_messages !== false : inChat;
  const chat: BotChat = {
    id: String(u.chat.id),
    title: (u.chat.title ?? u.chat.username ?? String(u.chat.id)).slice(0, 80),
    type: u.chat.type,
    username: u.chat.username ?? null,
    status,
    canPost,
    addedByOwner: !!ownerChatId && String(u.from.id) === ownerChatId,
    at: now.toISOString(),
  };
  const map = { ...((s.bot_chats ?? {}) as Record<string, BotChat>) };
  map[chat.id] = chat;
  await setSetting(db, "bot_chats", map);
  const dealsChannel = channelChatId(await clipboardValue(db, "deals_channel"));
  if (dealsChannel && chat.username && `@${chat.username}`.toLowerCase() === dealsChannel.toLowerCase()) {
    await setSetting(db, "channel_bot", { status, canPost, checkedAt: now.toISOString() });
  }
  const verb = inChat ? `added to ${chat.title} as ${status}` : `removed from ${chat.title}`;
  const tail = !chat.addedByOwner && inChat ? " by someone else, so it will not post there." : inChat && !canPost ? ", but it cannot post there yet: give it Post messages." : ".";
  await enqueueMessage(db, { kind: "bot_chat", body: `The bot was ${verb}${tail}`, now });
  return chat;
}
