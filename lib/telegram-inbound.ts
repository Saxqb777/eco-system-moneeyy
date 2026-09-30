// What arrives from Saaqib's phone: approve and reject buttons, feedback lines, commands, and plain ideas.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, floors, ideas } from "@/db/schema";
import { applyApprovalDecision } from "@/lib/approvals";
import { buildBrief, formatBrief } from "@/lib/brief";
import { recordBotChat, type ChatMemberUpdate } from "@/lib/channel";
import { setFloorPaused } from "@/lib/detail";
import { asBool, asNumber, getSettings, setSetting } from "@/lib/settings";
import { getTowerState } from "@/lib/state";
import { answerCallback, editMessage, getTelegramConfig, pairChat, pairingCode, sendNow } from "@/lib/telegram";
import type { TickTrigger } from "@/warden/tick";

export interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; text?: string; chat: { id: number | string }; from?: { id: number | string; first_name?: string } };
  callback_query?: { id: string; data?: string; from: { id: number | string }; message?: { message_id: number; text?: string; chat: { id: number | string } } };
  my_chat_member?: ChatMemberUpdate;
}

export interface InboundResult {
  handled: string;
  wantsTick?: TickTrigger;
}

const HELP = [
  "The Tower, commands:",
  "/status: one line per floor",
  "/brief: the morning brief now",
  "/pause <floor> and /resume <floor>",
  "/cap: daily cap, spend today, budget level",
  "/run: Warden runs now (once an hour)",
  "/reply <company>: <their text>, forward an email reply by hand",
  "/send <company>: <your text>, write to a lead yourself, it goes out now and replaces the drafted answer",
  "Anything else you write becomes an idea in Warden's mail slot.",
].join("\n");

function findFloor(rows: Array<{ slug: string; name: string }>, needle: string) {
  const n = needle.trim().toLowerCase();
  if (!n) return null;
  return rows.find((f) => f.slug === n) ?? rows.find((f) => f.name.toLowerCase().includes(n)) ?? null;
}

export async function processTelegramUpdate(db: Db, u: TelegramUpdate, now = new Date()): Promise<InboundResult> {
  const cfg = await getTelegramConfig(db);
  if (!cfg) return { handled: "stored, no bot token on the clipboard" };

  if (u.my_chat_member) {
    const chat = await recordBotChat(db, u.my_chat_member, cfg.chatId, now);
    return { handled: `bot is ${chat.status} in ${chat.title}` };
  }

  if (u.callback_query) {
    const cb = u.callback_query;
    const chatId = String(cb.message?.chat.id ?? cb.from.id);
    if (!cfg.chatId || chatId !== cfg.chatId) {
      await answerCallback(cfg.token, cb.id, "This chat is not paired with The Tower.");
      return { handled: "callback from a stranger, ignored" };
    }
    const m = (cb.data ?? "").match(/^ap:([0-9a-f-]{36}):([ar])$/);
    if (!m) {
      await answerCallback(cfg.token, cb.id, "Unknown button.");
      return { handled: "unknown callback" };
    }
    const [, approvalId, action] = m;
    const [a] = await db.select().from(approvals).where(eq(approvals.id, approvalId!)).limit(1);
    if (!a || a.status !== "pending") {
      await answerCallback(cfg.token, cb.id, "Already decided.");
      return { handled: "callback on a decided item" };
    }
    if (action === "a") {
      await applyApprovalDecision(db, approvalId!, "approved", null, "telegram", now);
      await answerCallback(cfg.token, cb.id, "Approved.");
      if (cb.message) await editMessage(cfg.token, chatId, cb.message.message_id, `${cb.message.text ?? a.summary}\n\nApproved.`);
      return { handled: "approved" };
    }
    await setSetting(db, "telegram_pending_reject", { approvalId, at: now.toISOString() });
    await answerCallback(cfg.token, cb.id, "Send one line of feedback.");
    await sendNow(cfg.token, chatId, `Rejecting: ${a.summary}\nReply with one line of feedback so the worker can redo it.`);
    return { handled: "reject, waiting for feedback" };
  }

  const msg = u.message;
  if (!msg || typeof msg.text !== "string") return { handled: "no text" };
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (!cfg.chatId) {
    const pair = text.match(/^\/pair(?:@\w+)?\s+([0-9a-f]{6})$/i);
    if (pair && pairingCode() && pair[1]!.toLowerCase() === pairingCode()) {
      await pairChat(db, chatId, now);
      await sendNow(cfg.token, chatId, "Paired. This chat now gets the morning brief, approvals and Warden's replies.\n\n" + HELP);
      return { handled: "paired" };
    }
    if (/^\/pair/i.test(text)) {
      await sendNow(cfg.token, chatId, `Almost. The pair line needs the six character code from the game: open Warden, Setup tab, "Your Telegram chat id", and send the whole line shown there, like /pair a1b2c3.\nOr paste this number into that box instead: ${chatId}`);
      return { handled: "pair without a valid code" };
    }
    if (text.startsWith("/start")) {
      await sendNow(cfg.token, chatId, `Hello. To pair this chat with The Tower: open the game, Warden, Setup tab, "Your Telegram chat id", and send the /pair line shown there. Or paste this number into that box: ${chatId}`);
      return { handled: "start before pairing" };
    }
    return { handled: "message before pairing, ignored" };
  }
  if (chatId !== cfg.chatId) return { handled: "message from a stranger, ignored" };

  const settingsMap = await getSettings(db);
  const pending = settingsMap.telegram_pending_reject as { approvalId?: string } | null;
  if (pending?.approvalId && !text.startsWith("/")) {
    const result = await applyApprovalDecision(db, pending.approvalId, "rejected", text.slice(0, 500), "telegram", now);
    await setSetting(db, "telegram_pending_reject", null);
    await sendNow(cfg.token, chatId, result ? "Rejected with your feedback. The worker redoes it." : "That item was already decided.");
    return { handled: "rejected with feedback" };
  }

  const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/s);
  if (cmd) {
    const [, name, argRaw] = cmd;
    const arg = (argRaw ?? "").trim();
    switch ((name ?? "").toLowerCase()) {
      case "start":
      case "help":
        await sendNow(cfg.token, chatId, HELP);
        return { handled: "help" };
      case "status": {
        const state = await getTowerState(db, now);
        const money = state.simulationMode ? state.money.simulated : state.money.real;
        const lines = [`The Tower, ${state.dubai.dayKey}${state.simulationMode ? " (SIMULATED)" : ""}`, `Net ${money.netUsd.toFixed(2)} USD, spend today ${money.spendTodayUsd.toFixed(2)} of ${state.budget.dailyCapUsd.toFixed(2)} USD, level ${state.budget.level}`, `${state.pendingApprovals} approval${state.pendingApprovals === 1 ? "" : "s"} waiting`];
        for (const f of state.floors) {
          const crew = f.agents.filter((a) => a.kind !== "warden");
          const bits = crew.length ? `${crew.filter((a) => a.status === "working").length} working, ${crew.filter((a) => a.status === "blocked").length} blocked` : "";
          lines.push(`• ${f.name}: ${f.status}${bits ? `, ${bits}` : ""}`);
        }
        await sendNow(cfg.token, chatId, lines.join("\n"));
        return { handled: "status" };
      }
      case "brief": {
        const brief = await buildBrief(db, now);
        await sendNow(cfg.token, chatId, formatBrief(brief));
        return { handled: "brief" };
      }
      case "pause":
      case "resume": {
        const rows = await db.select({ slug: floors.slug, name: floors.name }).from(floors);
        const floor = findFloor(rows, arg);
        if (!floor) {
          await sendNow(cfg.token, chatId, `Which floor? ${rows.map((r) => r.slug).join(", ")}`);
          return { handled: "pause without floor" };
        }
        const r = await setFloorPaused(db, floor.slug, name === "pause", now);
        await sendNow(cfg.token, chatId, r.ok ? `${floor.name} is now ${r.status}.` : r.error);
        return { handled: name ?? "pause" };
      }
      case "cap": {
        const simulation = asBool(settingsMap.simulation_mode, true);
        const state = await getTowerState(db, now);
        const money = simulation ? state.money.simulated : state.money.real;
        await sendNow(cfg.token, chatId, `Daily cap ${asNumber(settingsMap.daily_cap_usd, 1.7).toFixed(2)} USD, spent today ${money.spendTodayUsd.toFixed(2)} USD${simulation ? " (simulated)" : ""}. Budget level ${asNumber(settingsMap.budget_level, 1)}, hard ceiling ${asNumber(settingsMap.hard_ceiling_usd, 5).toFixed(2)} USD.`);
        return { handled: "cap" };
      }
      case "reply": {
        const m = arg.match(/^([^:]+):\s*([\s\S]+)$/);
        if (!m) {
          await sendNow(cfg.token, chatId, "Format: /reply <company>: <their text>");
          return { handled: "reply without text" };
        }
        const { recordInboundReply } = await import("@/lib/email");
        const r = await recordInboundReply(db, { from: m[1]!.trim(), subject: "Forwarded by the owner", text: m[2]!.trim(), company: m[1]!.trim() }, now);
        await sendNow(cfg.token, chatId, r.matched ? `Logged as a reply from ${r.company}. Chaser picks it up on the next heartbeat.` : "No lead matched that name. Check the company name in the floor panel.");
        return { handled: "reply", wantsTick: r.matched ? "manual" : undefined };
      }
      case "send": {
        const m = arg.match(/^([^:]+):\s*([\s\S]+)$/);
        if (!m) {
          await sendNow(cfg.token, chatId, "Format: /send <company>: <your text>");
          return { handled: "send without text" };
        }
        const { ownerSend } = await import("@/lib/owner-send");
        const r = await ownerSend(db, m[1]!, m[2]!, now);
        await sendNow(cfg.token, chatId, r.message);
        return { handled: r.ok ? "owner sent" : "owner send failed" };
      }
      case "run":
        await sendNow(cfg.token, chatId, "Warden is on it. Instant runs are limited to one an hour.");
        return { handled: "run", wantsTick: "manual" };
      default:
        await sendNow(cfg.token, chatId, `Unknown command. ${HELP}`);
        return { handled: "unknown command" };
    }
  }

  const [idea] = await db.insert(ideas).values({ text: text.slice(0, 2000), source: "telegram", status: "new", telegramMessageId: msg.message_id, createdAt: now }).returning({ id: ideas.id });
  void idea;
  await sendNow(cfg.token, chatId, "Noted, it is in the mail slot. Warden reads it on his next run and replies here.");
  return { handled: "idea", wantsTick: "idea" };
}
