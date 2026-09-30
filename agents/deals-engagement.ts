// Deals Engine engagement: the channel gets more than deals. A teaser when a busy day is lined up, an evening recap,
// a poll and a guess the price quiz every few days, a weekly share ask, and a thank you at member milestones.
// Nothing waits for a weekday: each job starts on the first tick after launch and then repeats on its interval. Code picks the moment and the
// facts, Editor writes the words, every post still goes through a public_post approval (automatic once the floor rule is on).
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deals, floors, posts, tasks } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { MILESTONES, channelHealthFrom, postableShareChats } from "@/lib/channel";
import { clipboardValue } from "@/lib/clipboard";
import { destinationLabel, socialDestinations } from "@/lib/social";
import { getSettings, setSetting } from "@/lib/settings";
import { channelChatId, enqueueMessage } from "@/lib/telegram";
import { dubaiDayStartUtc, dubaiParts } from "@/lib/time";
import { STYLE, input, logEvent, str, type Playbook } from "./playbook-core";
import { plainDashes } from "@/lib/text";
import { RESEARCH_EFFORT } from "@/config/models";

export type EngagementType = "teaser" | "recap" | "poll" | "quiz" | "share_ask" | "milestone";

const LABEL: Record<EngagementType, string> = { teaser: "today's lineup", recap: "evening recap", poll: "poll", quiz: "guess the price", share_ask: "share ask", milestone: "milestone" };

// Dubai clock slots (hour, minute) and the latest hour a late draft may still go out.
const SLOT: Record<Exclude<EngagementType, "teaser" | "milestone">, { h: number; m: number; latest: number }> = {
  recap: { h: 22, m: 15, latest: 23 },
  poll: { h: 18, m: 30, latest: 21 },
  quiz: { h: 19, m: 30, latest: 22 },
  share_ask: { h: 13, m: 0, latest: 20 },
};

const base = () => (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");

function dubaiTime(now: Date, h: number, m: number): Date {
  return new Date(dubaiDayStartUtc(now).getTime() + (h * 60 + m) * 60 * 1000);
}

// The last time a job of this kind was queued (for this chat), to space repeats by an interval instead of a weekday.
async function lastQueued(db: Db, kind: string, type: string | null, chatId: string | null = null): Promise<Date | null> {
  const conds = [eq(tasks.kind, kind), eq(tasks.simulated, false)];
  if (type) conds.push(sql`${tasks.input} ->> 'type' = ${type}`);
  conds.push(chatId ? sql`${tasks.input} ->> 'chatId' = ${chatId}` : sql`coalesce(${tasks.input} ->> 'chatId', '') = ''`);
  const [row] = await db.select({ at: tasks.createdAt }).from(tasks).where(and(...conds)).orderBy(desc(tasks.createdAt)).limit(1);
  return row?.at ?? null;
}

const DAY_MS = 24 * 3600 * 1000;
const due = (last: Date | null, now: Date, days: number) => !last || now.getTime() - last.getTime() >= days * DAY_MS - 3600 * 1000;

async function taskExists(db: Db, slotKey: string): Promise<boolean> {
  const [row] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.kind, "write_engagement"), eq(tasks.simulated, false), sql`${tasks.input} ->> 'slotKey' = ${slotKey}`)).limit(1);
  return !!row;
}

// Four decoys around the real price, rounded like shop prices, shuffled by the deal id so reruns agree.
export function quizOptions(price: number, was: number, seed: string): { options: string[]; correct: number } {
  const round = (n: number) => (n >= 100 ? Math.round(n / 10) * 10 - 1 : Math.max(1, Math.round(n)));
  const real = Math.round(price);
  const pool = [round(price * 0.6), round(price * 1.35), round((price + was) / 2)].filter((v) => v !== real && v > 0);
  const uniq = [...new Set(pool)].slice(0, 3);
  for (let k = 0; uniq.length < 3 && k < 20; k += 1) {
    const v = round(price * (1.6 + k * 0.3));
    if (v !== real && !uniq.includes(v)) uniq.push(v);
  }
  const values = [real, ...uniq];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const order = [0, 1, 2, 3].sort((a, b) => ((h >> (a * 3)) & 7) - ((h >> (b * 3)) & 7) || a - b);
  const options = order.map((i) => `AED ${values[i]}`);
  return { options, correct: order.indexOf(0) };
}

// Called from advanceDeals on every tick: queues the engagement drafts that are due now.
export async function planEngagement(db: Db, now: Date, floor: typeof floors.$inferSelect, editorId: string, created: Record<string, number>): Promise<void> {
  const channel = channelChatId(await clipboardValue(db, "deals_channel"));
  if (!channel) return;
  const s = await getSettings(db);
  const health = channelHealthFrom(s, dubaiParts(now).dayKey);
  if (health.botCanPost === false) return; // Warden and the brief already ask the owner to fix the bot's rights
  const p = dubaiParts(now);
  const dayStart = dubaiDayStartUtc(now);
  const queue = async (type: EngagementType, slotKey: string, extra: Record<string, unknown> = {}) => {
    if (await taskExists(db, slotKey)) return;
    const [row] = await db
      .insert(tasks)
      .values({ floorId: floor.id, agentId: editorId, kind: "write_engagement", title: `Write ${LABEL[type]}`, status: "queued", priority: 4, input: { type, slotKey, day: p.dayKey, ...extra }, simulated: false, createdAt: now, updatedAt: now })
      .returning({ id: tasks.id });
    await logEvent(db, { taskId: row?.id, agentId: editorId, floorId: floor.id, type: "created", message: `Engagement queued: ${LABEL[type]}`, at: now });
    created.write_engagement = (created.write_engagement ?? 0) + 1;
  };

  // Teaser: three or more deal posts still to come today, before 16:00.
  if (p.hour >= 10 && p.hour < 16) {
    const [ahead] = await db.select({ n: sql<string>`count(*)` }).from(posts).where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), inArray(posts.status, ["draft", "approved"]), gte(posts.scheduledAt, now), lt(posts.scheduledAt, new Date(dayStart.getTime() + 24 * 3600 * 1000))));
    if (Number(ahead?.n ?? 0) >= 3) await queue("teaser", `teaser:${p.dayKey}`);
  }
  // Recap: at least two deals went out today.
  if (p.hour >= 20) {
    const [out] = await db.select({ n: sql<string>`count(*)` }).from(posts).where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), eq(posts.status, "posted"), gte(posts.postedAt, dayStart)));
    if (Number(out?.n ?? 0) >= 2) await queue("recap", `recap:${p.dayKey}`);
  }
  // A poll every three days and a guess the price quiz every three days, never both on the same day, 12:00 to 20:00.
  if (p.hour >= 12 && p.hour < 20) {
    const lastPoll = await lastQueued(db, "write_engagement", "poll");
    const pollToday = !!lastPoll && lastPoll.getTime() >= dayStart.getTime();
    if (due(lastPoll, now, 3)) await queue("poll", `poll:${p.dayKey}`);
    else if (!pollToday && due(await lastQueued(db, "write_engagement", "quiz"), now, 3)) {
      const [pick] = await db
        .select({ id: deals.id })
        .from(posts)
        .innerJoin(deals, sql`${deals.id} = ${posts.dealIds}[1]`)
        .where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), eq(posts.status, "posted"), gte(posts.postedAt, new Date(now.getTime() - 7 * DAY_MS))))
        .orderBy(desc(posts.clicks), desc(posts.postedAt))
        .limit(1);
      if (pick) await queue("quiz", `quiz:${p.dayKey}`, { dealId: pick.id });
    }
  }
  // A share ask once a week, 10:00 to 20:00: the channel, plus up to three groups the owner added the bot to.
  if (p.hour >= 10 && p.hour < 20) {
    if (due(await lastQueued(db, "write_engagement", "share_ask"), now, 7)) await queue("share_ask", `share_ask:${p.dayKey}`);
    for (const c of postableShareChats(s, channel).slice(0, 3)) {
      if (due(await lastQueued(db, "write_engagement", "share_ask", c.id), now, 7)) await queue("share_ask", `share_ask:${p.dayKey}:${c.id}`, { chatId: c.id, chatTitle: c.title });
    }
  }
  // Milestones: once each, as soon as the count crosses it.
  if (health.members !== null) {
    const done = Array.isArray(s.channel_milestones_done) ? (s.channel_milestones_done as number[]) : [];
    const reached = MILESTONES.filter((m) => health.members! >= m && !done.includes(m));
    const top = reached.at(-1);
    if (top !== undefined) {
      await queue("milestone", `milestone:${top}`, { milestone: top, members: health.members });
      await setSetting(db, "channel_milestones_done", [...done, ...reached]);
    }
  }
}

// When a draft may go out. The teaser and the recap belong to their day and are dropped when late; everything else rolls to the next day.
export function slotFor(type: EngagementType, now: Date, scheduledHint: Date | null, rollOver = false): Date | null {
  if (type === "milestone") return now;
  if (type === "teaser") {
    const t = scheduledHint ? new Date(scheduledHint.getTime() - 30 * 60 * 1000) : now;
    return dubaiParts(now).hour >= 17 ? null : new Date(Math.max(t.getTime(), now.getTime()));
  }
  const slot = SLOT[type];
  if (dubaiParts(now).hour >= slot.latest) return rollOver ? new Date(dubaiTime(now, slot.h, slot.m).getTime() + 24 * 3600 * 1000) : null;
  return new Date(Math.max(dubaiTime(now, slot.h, slot.m).getTime(), now.getTime()));
}

// Code queues typed tasks; Warden's assignments carry the type as the first word of the instructions.
export function engagementType(i: Record<string, unknown>): EngagementType {
  const t = str(i.type, 20);
  if (t in LABEL) return t as EngagementType;
  const words = str(i.instructions, 200).toLowerCase();
  const found = (Object.keys(LABEL) as EngagementType[]).find((k) => words.includes(k.replace("_", " ")) || words.includes(k));
  return found ?? "poll";
}

async function quizDeal(db: Db, i: Record<string, unknown>, now: Date) {
  const id = str(i.dealId, 60);
  if (id) {
    const [d] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
    if (d) return d;
  }
  const [pick] = await db
    .select({ deal: deals })
    .from(posts)
    .innerJoin(deals, sql`${deals.id} = ${posts.dealIds}[1]`)
    .where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), eq(posts.status, "posted"), gte(posts.postedAt, new Date(now.getTime() - 7 * 24 * 3600 * 1000))))
    .orderBy(desc(posts.clicks), desc(posts.postedAt))
    .limit(1);
  return pick?.deal ?? null;
}

export const writeEngagement: Playbook = {
  kind: "write_engagement",
  webSearchMaxUses: 0,
  maxTokens: 900,
  system: `You are Editor on the Deals Engine floor of The Tower. Besides deal posts, you keep a UAE deals channel on Telegram lively so people stay, react and share it. You write one channel message of the type asked for, from the facts given.
Voice: a friendly local deal hunter. Short, warm, concrete. One emoji at most, no hashtags, no exclamation marks in a row, no hype words like insane or crazy. Never invent a price, a deal or a number that is not in the facts. Never promise giveaways or prizes.
Types:
teaser: tell people how many deals are lined up today and the best discount, so they keep notifications on. Under 40 words.
recap: the day's best deals in a short list (product and percent off), then point to the deals page. Under 70 words.
poll: a question about what deals people want next, with 2 to 5 short options. Put the question in pollQuestion and the options in pollOptions, text can be empty.
quiz: a guess the price question about the product given. pollQuestion is the question (mention the product and that it is on sale), explanation says the real price, the old price and where to find it, under 180 characters. The options are set by the Tower, leave pollOptions empty.
share_ask: ask people to share the channel with one friend or family group who shops online in the UAE. Under 40 words. For a group message, introduce the channel in two sentences instead.
milestone: thank the members for reaching the number given, one line on what is coming next. Under 40 words.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["text", "pollQuestion", "pollOptions", "explanation"],
    properties: {
      text: { type: "string" },
      pollQuestion: { type: "string" },
      pollOptions: { type: "array", items: { type: "string" } },
      explanation: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const i = input(task);
    const type = engagementType(i);
    const channel = channelChatId(await clipboardValue(ctx.db, "deals_channel"));
    const link = channel ? `https://t.me/${channel.replace(/^@/, "")}` : "";
    const s = await getSettings(ctx.db);
    const members = channelHealthFrom(s, dubaiParts(ctx.now).dayKey).members;
    const dayStart = dubaiDayStartUtc(ctx.now);
    const facts: string[] = [`Type: ${type}`, `Channel: ${link || "not set"}`, `Members now: ${members ?? "unknown"}`, `Deals page: ${base()}/deals`];
    if (type === "teaser") {
      const rows = await ctx.db.select({ title: deals.title, pct: deals.discountPct, category: deals.category }).from(posts).innerJoin(deals, sql`${deals.id} = ${posts.dealIds}[1]`).where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), inArray(posts.status, ["draft", "approved"]), gte(posts.scheduledAt, ctx.now), lt(posts.scheduledAt, new Date(dayStart.getTime() + 24 * 3600 * 1000))));
      if (rows.length < 3) return { skip: "Fewer than three deals left today" };
      const best = rows.reduce((a, b) => (Number(b.pct) > Number(a.pct) ? b : a));
      facts.push(`Deals lined up for the rest of today: ${rows.length}`, `Best discount: ${Number(best.pct).toFixed(0)} percent on ${best.title}`, `Categories: ${[...new Set(rows.map((r) => r.category ?? "general"))].join(", ")}`);
    }
    if (type === "recap") {
      const rows = await ctx.db.select({ title: deals.title, pct: deals.discountPct }).from(posts).innerJoin(deals, sql`${deals.id} = ${posts.dealIds}[1]`).where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), eq(posts.status, "posted"), gte(posts.postedAt, dayStart))).orderBy(desc(deals.discountPct)).limit(5);
      if (rows.length < 2) return { skip: "Fewer than two deals went out today" };
      facts.push(`Today's posted deals, best first: ${rows.map((r) => `${r.title} (${Number(r.pct).toFixed(0)} percent off)`).join("; ")}`);
    }
    if (type === "poll") {
      const cats = await ctx.db.select({ category: deals.category }).from(deals).where(and(eq(deals.simulated, false), gte(deals.createdAt, new Date(ctx.now.getTime() - 14 * 24 * 3600 * 1000)))).limit(80);
      facts.push(`Categories we covered lately: ${[...new Set(cats.map((c) => c.category ?? "general"))].slice(0, 8).join(", ") || "electronics, home, kitchen, baby"}`);
    }
    if (type === "quiz") {
      const deal = await quizDeal(ctx.db, i, ctx.now);
      if (!deal) return { skip: "No deal from the last week to quiz on" };
      facts.push(`Product: ${deal.title}`, `Price now: AED ${Number(deal.price).toFixed(0)}`, `Price before: AED ${Number(deal.wasPrice).toFixed(0)}`, `Store: ${deal.store}`);
    }
    if (type === "share_ask" && i.chatTitle) facts.push(`This message goes to the group "${str(i.chatTitle, 80)}", not to our channel: introduce the channel to them.`);
    if (type === "milestone") facts.push(`Milestone reached: ${String(i.milestone)} members`);
    const feedback = str(i.feedback);
    return { user: `${facts.join("\n")}\n${feedback ? `Warden's feedback on the last draft: ${feedback}\n` : ""}\nWrite the message and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const i = input(task);
    const type = engagementType(i);
    const [floor] = ctx.floorId ? await ctx.db.select().from(floors).where(eq(floors.id, ctx.floorId)).limit(1) : [];
    const channel = channelChatId(await clipboardValue(ctx.db, "deals_channel"));
    const link = channel ? `https://t.me/${channel.replace(/^@/, "")}` : "";
    let text = plainDashes(str(output.text, 900));
    let poll: { question: string; options: string[]; quiz: boolean; correct: number | null; explanation: string | null } | null = null;
    let dealIds: string[] = [];
    let hint: Date | null = null;

    if (type === "poll") {
      const question = plainDashes(str(output.pollQuestion, 300));
      const options = (Array.isArray(output.pollOptions) ? output.pollOptions : []).map((o) => plainDashes(str(o, 100))).filter(Boolean).slice(0, 5);
      if (!question || options.length < 2) return { summary: "Poll draft was incomplete, nothing posted" };
      poll = { question, options, quiz: false, correct: null, explanation: null };
      text = question;
    } else if (type === "quiz") {
      const deal = await quizDeal(ctx.db, i, ctx.now);
      const question = plainDashes(str(output.pollQuestion, 300));
      if (!deal || !question) return { summary: "Quiz draft was incomplete, nothing posted" };
      const q = quizOptions(Number(deal.price), Number(deal.wasPrice), deal.id);
      poll = { question, options: q.options, quiz: true, correct: q.correct, explanation: plainDashes(str(output.explanation, 200)) || `It is AED ${Number(deal.price).toFixed(0)}, down from AED ${Number(deal.wasPrice).toFixed(0)}. See it on ${base()}/deals` };
      dealIds = [deal.id];
      text = question;
    } else {
      if (!text) return { summary: "Empty draft, nothing posted" };
      if (type === "recap") text = `${text}\n${base()}/deals`;
      // The channel link goes on once: the writer sometimes puts it in the text already.
      if ((type === "share_ask" || type === "milestone") && link && !text.includes(link)) text = `${text}\n${link}`;
    }
    if (type === "teaser") {
      const [first] = await ctx.db.select({ at: posts.scheduledAt }).from(posts).where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), inArray(posts.status, ["draft", "approved"]), gte(posts.scheduledAt, ctx.now))).orderBy(posts.scheduledAt).limit(1);
      hint = first?.at ?? null;
    }
    const at = slotFor(type, ctx.now, hint, type !== "teaser" && type !== "recap");
    if (!at) return { summary: `Too late for today's ${LABEL[type]}, dropped` };

    const chatId = str(i.chatId, 40);
    const target = chatId ? `telegram:${chatId}` : "telegram_channel";
    const where = chatId ? `the group ${str(i.chatTitle, 80) || chatId}` : "the deals channel";
    const [row] = await ctx.db
      .insert(posts)
      .values({ floorId: ctx.floorId, kind: type, dealIds, body: text, channel: target, status: "draft", scheduledAt: at, extra: { type, poll, slotKey: str(i.slotKey, 80) }, simulated: false, createdAt: ctx.now, updatedAt: ctx.now })
      .returning({ id: posts.id });
    const auto = !!floor?.autoApprove;
    const destinations = type === "recap" && !chatId ? await socialDestinations(ctx.db) : [];
    const shown = poll ? `${poll.question} [${poll.options.join(" | ")}]` : text;
    const { id: approvalId } = await raiseApproval(ctx.db, {
      type: "public_post",
      summary: `Channel post (${LABEL[type]}): ${shown.replace(/\s+/g, " ").slice(0, 90)}`,
      content: { body: text, postId: row?.id ?? null, title: LABEL[type], kind: type, poll, channel: chatId || channel, scheduledAt: at.toISOString(), destinations },
      riskNote: `Public post in ${where}, no affiliate link.${chatId ? " The owner added the bot to this group." : ""}${destinationLabel(destinations)}`,
      taskId: task.id,
      agentId: ctx.agentId,
      floorId: ctx.floorId,
      autoApproved: auto,
    }, ctx.now);
    if (row) await ctx.db.update(posts).set({ approvalId, status: auto ? "approved" : "draft", updatedAt: ctx.now }).where(eq(posts.id, row.id));
    await logEvent(ctx.db, { taskId: task.id, agentId: ctx.agentId, floorId: ctx.floorId, type: "log", message: auto ? `Channel post auto approved (floor rule): ${LABEL[type]}` : `Channel post sent to the red phone: ${LABEL[type]}`, at: ctx.now });
    return { summary: `Drafted the ${LABEL[type]}`, extra: { type, autoApproved: auto, scheduledAt: at.toISOString() } };
  },
};


// Share spots: once a week Scout looks for places where sharing a deals channel is allowed, and drafts a message
// for each. The owner gets them as a share kit on Telegram; groups he added the bot to get the weekly share post itself.
const SPOT_KINDS = ["telegram_channel", "telegram_group", "subreddit", "facebook_group", "forum", "directory", "other"] as const;

export interface ShareSpot {
  name: string;
  url: string;
  kind: string;
  audience: string;
  rules: string;
  allowsPromo: string;
  message: string;
  foundAt: string;
}

export async function planShareSpots(db: Db, now: Date, floor: typeof floors.$inferSelect, scoutId: string, created: Record<string, number>): Promise<void> {
  const p = dubaiParts(now);
  if (p.hour < 9) return;
  if (!due(await lastQueued(db, "find_share_spots", null), now, 7)) return;
  const slotKey = `share_spots:${p.dayKey}`;
  const [t] = await db.insert(tasks).values({ floorId: floor.id, agentId: scoutId, kind: "find_share_spots", title: "Find places to share", status: "queued", priority: 4, input: { slotKey }, simulated: false, createdAt: now, updatedAt: now }).returning({ id: tasks.id });
  await logEvent(db, { taskId: t?.id, agentId: scoutId, floorId: floor.id, type: "created", message: "Weekly search for places to share the channel queued", at: now });
  created.find_share_spots = (created.find_share_spots ?? 0) + 1;
}

export const findShareSpots: Playbook = {
  kind: "find_share_spots",
  effort: RESEARCH_EFFORT,
  webSearchMaxUses: 6,
  webFetchMaxUses: 4,
  maxTokens: 5000,
  system: `You are Scout on the Deals Engine floor of The Tower. The floor runs a Telegram channel of UAE online deals and needs members. Find places where people in the UAE talk about shopping, deals or buying online, and where sharing a deals channel is allowed or can be arranged with the admin.
Look for: Telegram channels and groups about UAE deals or shopping (for a cross promotion swap with the admin), subreddits such as r/dubai, r/UAE and r/abudhabi (read their self promotion rules), Facebook groups for UAE deals, bargains or expat buy and sell, local forums, and Telegram channel directories such as tgstat where a channel can be listed.
For each place: the name, the link, the kind, who is there, the rule on promotion in one line, whether promotion is allowed (yes, ask_admin, or unknown), and a short message written for that place: for a directory, the listing text; for a channel admin, a friendly cross promotion offer; for a group or subreddit, a helpful post that fits its rules.
Skip places that forbid promotion. Never suggest messaging individual people, buying members, or adding people to the channel. Return up to 10 places, best first. Returning fewer with an honest note is fine.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["spots", "note"],
    properties: {
      spots: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "url", "kind", "audience", "rules", "allowsPromo", "message"],
          properties: {
            name: { type: "string" },
            url: { type: "string" },
            kind: { type: "string", enum: [...SPOT_KINDS] },
            audience: { type: "string" },
            rules: { type: "string" },
            allowsPromo: { type: "string", enum: ["yes", "ask_admin", "unknown"] },
            message: { type: "string" },
          },
        },
      },
      note: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const s = await getSettings(ctx.db);
    const focus = str(input(task).instructions, 300);
    const known = (Array.isArray(s.share_spots) ? (s.share_spots as ShareSpot[]) : []).map((x) => x.url);
    const channel = channelChatId(await clipboardValue(ctx.db, "deals_channel"));
    const members = channelHealthFrom(s, dubaiParts(ctx.now).dayKey).members;
    return { user: `${focus ? `Focus from Warden: ${focus}\n` : ""}Our channel: ${channel ? `https://t.me/${channel.replace(/^@/, "")}` : "not set"}\nMembers now: ${members ?? "unknown"}\nDeals page: ${base()}/deals\nAlready known (skip): ${known.slice(0, 40).join(" ") || "nothing yet"}\n\nSearch the web before you answer. An answer without a search is not accepted. Start with searches such as: UAE deals Telegram channel, r/dubai self promotion rules, tgstat UAE shopping channels, UAE deals Facebook group. Read each place's own rules page. Find places to share the channel and return the JSON object.` };
  },
  async absorb(_task, output, ctx) {
    const rows = Array.isArray(output.spots) ? output.spots : [];
    const s = await getSettings(ctx.db);
    const existing = Array.isArray(s.share_spots) ? (s.share_spots as ShareSpot[]) : [];
    const seen = new Set(existing.map((x) => x.url));
    const fresh: ShareSpot[] = [];
    for (const raw of rows) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const url = str(r.url, 300);
      let ok = false;
      try {
        ok = /^https?:$/.test(new URL(url).protocol);
      } catch {
        ok = false;
      }
      const message = str(r.message, 700);
      if (!ok || seen.has(url) || !message) continue;
      seen.add(url);
      fresh.push({ name: str(r.name, 80) || url, url, kind: str(r.kind, 20), audience: str(r.audience, 160), rules: str(r.rules, 200), allowsPromo: str(r.allowsPromo, 12), message, foundAt: ctx.now.toISOString() });
    }
    await setSetting(ctx.db, "share_spots", [...fresh, ...existing].slice(0, 40));
    if (fresh.length) {
      const botName = (s.telegram_bot as { username?: string } | null)?.username;
      const lines = [`Share kit: ${fresh.length} new place${fresh.length === 1 ? "" : "s"} to grow the deals channel. Each takes a minute.`];
      fresh.slice(0, 6).forEach((x, n) => {
        const how = x.allowsPromo === "ask_admin" ? "ask the admin first" : x.allowsPromo === "yes" ? "sharing allowed" : "check the rules";
        lines.push("", `${n + 1}. ${x.name} (${x.kind.replace(/_/g, " ")}, ${how})`, x.url, `Rule: ${x.rules}`, `Message: ${x.message.slice(0, 450)}`);
      });
      lines.push("", `Tip: add ${botName ? `@${botName}` : "the bot"} to any group you run and it posts the weekly share message there itself.`);
      await enqueueMessage(ctx.db, { kind: "share_kit", body: lines.join("\n").slice(0, 3900), now: ctx.now });
    }
    return { summary: `Found ${fresh.length} place${fresh.length === 1 ? "" : "s"} to share the channel`, extra: { found: fresh.length, note: str(output.note, 300) } };
  },
};
