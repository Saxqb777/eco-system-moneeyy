// The AI half of Wall Street (D075): the News Hound reads headlines, the desk meeting (Bull, Bear and the
// Chief) decides on a signal, the morning brief sets the day's mood and the Coach writes a lesson after trades.
// Every call goes through the model wrapper and fits inside the floor's own daily money and the Tower's cap.
// In simulation mode nobody calls a model: the same jobs run on simple rules (rule 4).
import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { callModel } from "@/agents/client";
import { budgetLeftUsd } from "@/agents/spend-guard";
import { AI_COST_USD, CRYPTO_WATCHLIST, RISK, STOCK_WATCHLIST, TRADING_DAILY_USD, type Market } from "@/config/trading";
import type { Db } from "@/db/client";
import { agents, floors, tradingNews, tradingPositions } from "@/db/schema";
import { getSpendSummary } from "@/lib/budget";
import type { MarketData } from "@/lib/market";
import { asNumber, getSetting, getSettings, setSetting } from "@/lib/settings";
import { plainDashes } from "@/lib/text";
import { dubaiParts } from "@/lib/time";
import { fmtPrice, shortSymbol, tradingEvent, type Desk, type Position } from "./engine";
import { round } from "./indicators";
import { SIGNAL_WORDS, type SignalIdea } from "./scanner";

export type AiJob = keyof typeof AI_COST_USD;

async function floorId(db: Db): Promise<string | null> {
  const [f] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "trading")).limit(1);
  return f?.id ?? null;
}

async function agentId(db: Db, slug: string): Promise<string | null> {
  const [a] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, slug)).limit(1);
  return a?.id ?? null;
}

export interface AiBudget {
  spentTodayUsd: number;
  limitUsd: number;
  capLeftUsd: number;
  leftUsd: number;
}

// What the crew may still spend today: the floor's own limit and whatever is left of the Tower's cap.
export async function aiBudget(db: Db, now: Date): Promise<AiBudget> {
  const s = await getSettings(db);
  const limitUsd = asNumber(s.trading_daily_usd, TRADING_DAILY_USD);
  const fid = await floorId(db);
  const spend = await getSpendSummary(db, false, now);
  const spentTodayUsd = fid ? spend.todayByFloor[fid] ?? 0 : 0;
  const cap = await budgetLeftUsd(db, now);
  return { spentTodayUsd, limitUsd, capLeftUsd: cap.leftUsd, leftUsd: Math.min(limitUsd - spentTodayUsd, cap.leftUsd) };
}

export async function canAfford(db: Db, job: AiJob, now: Date): Promise<boolean> {
  return (await aiBudget(db, now)).leftUsd >= AI_COST_USD[job];
}

const clean = (v: unknown, max = 240) => plainDashes(String(v ?? "").replace(/\s+/g, " ").trim()).slice(0, max);

// News

// New headlines for the watchlist since the last look, kept once each.
export async function fetchNews(db: Db, market: MarketData, now: Date): Promise<number> {
  const [last] = await db.select({ at: tradingNews.publishedAt }).from(tradingNews).orderBy(desc(tradingNews.publishedAt)).limit(1);
  const since = last ? new Date(last.at.getTime() + 1000) : new Date(now.getTime() - 6 * 3600_000);
  const items = await market.news([...STOCK_WATCHLIST, ...CRYPTO_WATCHLIST], since);
  let added = 0;
  for (const it of items.slice(0, 50)) {
    const rows = await db
      .insert(tradingNews)
      .values({ sourceId: it.id, headline: clean(it.headline, 300), summary: it.summary ? clean(it.summary, 600) : null, url: it.url, source: it.source, symbols: it.symbols, publishedAt: new Date(it.createdAt), simulated: market.source === "sim", createdAt: now })
      .onConflictDoNothing()
      .returning({ id: tradingNews.id });
    added += rows.length;
  }
  return added;
}

const NEWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          n: { type: "integer" },
          sentiment: { type: "string", enum: ["bullish", "bearish", "neutral"] },
          impact: { type: "integer", enum: [1, 2, 3] },
          note: { type: "string" },
        },
        required: ["n", "sentiment", "impact", "note"],
      },
    },
  },
  required: ["items"],
};

const HOUND_SYSTEM = `You are the News Hound on a paper trading floor. You read market headlines and tag each one for the traders.
For every headline give: sentiment for the named stock or coin (bullish, bearish or neutral), impact 1 to 3 (3 means it can move the price today), and a note of at most 12 plain words saying why.
Most headlines are neutral with impact 1. Only real news (earnings surprises, guidance, regulation, big deals, hacks, lawsuits) gets impact 3.
Write in plain English. Never use dashes or hyphens as punctuation.`;

// Tags waiting headlines in one call once enough have piled up or the oldest waited 40 minutes.
export async function houndTags(db: Db, now: Date, simulation: boolean): Promise<{ tagged: number; costUsd: number; status: string }> {
  const waiting = await db.select().from(tradingNews).where(isNull(tradingNews.taggedAt)).orderBy(asc(tradingNews.publishedAt)).limit(30);
  if (!waiting.length) return { tagged: 0, costUsd: 0, status: "nothing new" };
  const oldest = waiting[0]!.createdAt.getTime();
  if (waiting.length < 6 && now.getTime() - oldest < 40 * 60_000) return { tagged: 0, costUsd: 0, status: "waiting for more" };
  let tags: Array<{ n: number; sentiment: string; impact: number; note: string }>;
  let costUsd = 0;
  if (simulation) {
    tags = waiting.map((w, i) => ({ n: i + 1, sentiment: /climb|jump|beat|rall/i.test(w.headline) ? "bullish" : /slip|fall|drop|miss/i.test(w.headline) ? "bearish" : "neutral", impact: 2, note: "simulation" }));
  } else {
    if (!(await canAfford(db, "news", now))) return { tagged: 0, costUsd: 0, status: "no AI money left today" };
    const list = waiting.map((w, i) => `${i + 1}. [${w.symbols.join(", ") || "market"}] ${w.headline}`).join("\n");
    const res = await callModel(db, { agentKey: "worker", agentId: await agentId(db, "trading_news"), floorId: await floorId(db), system: HOUND_SYSTEM, messages: [{ role: "user", content: `Tag these headlines:\n${list}` }], schema: NEWS_SCHEMA, maxTokens: 1500 }, now);
    costUsd = res.costUsd;
    tags = ((res.json as { items?: typeof tags } | null)?.items ?? []).filter((t) => t && typeof t.n === "number");
  }
  let tagged = 0;
  let loudest: { headline: string; sentiment: string; impact: number; symbols: string[] } | null = null;
  for (const t of tags) {
    const row = waiting[t.n - 1];
    if (!row) continue;
    const sentiment = ["bullish", "bearish", "neutral"].includes(t.sentiment) ? t.sentiment : "neutral";
    const impact = Math.max(1, Math.min(3, Math.round(t.impact)));
    await db.update(tradingNews).set({ sentiment, impact, taggedAt: now }).where(eq(tradingNews.id, row.id));
    tagged += 1;
    if (sentiment !== "neutral" && (!loudest || impact > loudest.impact)) loudest = { headline: row.headline, sentiment, impact, symbols: row.symbols };
  }
  // anything the model skipped is marked read, so it is not sent again
  for (const w of waiting) await db.update(tradingNews).set({ taggedAt: now }).where(and(eq(tradingNews.id, w.id), isNull(tradingNews.taggedAt)));
  if (loudest && loudest.impact >= 2) {
    await tradingEvent(db, { agentSlug: "trading_news", message: `Hound: ${loudest.headline}`, data: { kind: "news", sentiment: loudest.sentiment, impact: loudest.impact, symbols: loudest.symbols, headline: clean(loudest.headline, 120) }, at: now });
  }
  return { tagged, costUsd, status: "tagged" };
}

// Recent tagged news for one symbol, for the meeting.
export async function newsFor(db: Db, symbol: string, now: Date): Promise<Array<{ headline: string; sentiment: string | null; impact: number | null }>> {
  const key = symbol.replace("/", "");
  return db
    .select({ headline: tradingNews.headline, sentiment: tradingNews.sentiment, impact: tradingNews.impact })
    .from(tradingNews)
    .where(and(gte(tradingNews.publishedAt, new Date(now.getTime() - 36 * 3600_000)), sql`${key} = any(${tradingNews.symbols})`))
    .orderBy(desc(tradingNews.publishedAt))
    .limit(5);
}

// The morning brief

export interface MorningBrief {
  dayKey: string;
  mood: "bullish" | "bearish" | "mixed";
  headline: string;
  watch: string[];
  avoid: string[];
  notes: string;
  at: string;
}

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mood: { type: "string", enum: ["bullish", "bearish", "mixed"] },
    headline: { type: "string" },
    watch: { type: "array", items: { type: "string" } },
    avoid: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["mood", "headline", "watch", "avoid", "notes"],
};

const BRIEF_SYSTEM = `You write the morning brief for a small paper trading floor that trades US stocks and crypto, long only.
Search the web for what moves markets today: the US futures, economic data due today, big earnings, crypto news.
Then give: the mood (bullish, bearish or mixed), a one line headline, up to 4 symbols from the watchlist worth watching, up to 4 to avoid today, and notes of at most 60 plain words for the traders.
Only use symbols from this watchlist: ${[...STOCK_WATCHLIST, ...CRYPTO_WATCHLIST].join(", ")}.
Be factual and say when something is uncertain. Write in plain English. Never use dashes or hyphens as punctuation.`;

// Once a Dubai day, from 15:30 Dubai, before the US open.
export async function morningBrief(db: Db, now: Date, simulation: boolean): Promise<{ status: string; costUsd: number }> {
  const p = dubaiParts(now);
  const have = await getSetting<MorningBrief | null>(db, "trading_brief", null);
  if (have?.dayKey === p.dayKey) return { status: "done today", costUsd: 0 };
  if (p.hour < 15 || (p.hour === 15 && p.minute < 30)) return { status: "not yet", costUsd: 0 };
  let brief: MorningBrief;
  let costUsd = 0;
  if (simulation) {
    brief = { dayKey: p.dayKey, mood: p.day % 3 === 0 ? "bearish" : p.day % 3 === 1 ? "bullish" : "mixed", headline: "A quiet made up market today", watch: ["NVDA", "BTC/USD"], avoid: ["TSLA"], notes: "Simulation: no real news was read.", at: now.toISOString() };
  } else {
    if (!(await canAfford(db, "brief", now))) return { status: "no AI money left today", costUsd: 0 };
    const res = await callModel(db, { agentKey: "worker", agentId: await agentId(db, "trading_news"), floorId: await floorId(db), system: BRIEF_SYSTEM, messages: [{ role: "user", content: `Today is ${p.dayKey}. Write the brief.` }], schema: BRIEF_SCHEMA, maxTokens: 2500, webSearchMaxUses: 3, effort: "medium" }, now);
    costUsd = res.costUsd;
    const j = (res.json ?? {}) as Partial<MorningBrief>;
    const allowed = new Set([...STOCK_WATCHLIST, ...CRYPTO_WATCHLIST]);
    brief = {
      dayKey: p.dayKey,
      mood: j.mood === "bullish" || j.mood === "bearish" ? j.mood : "mixed",
      headline: clean(j.headline, 140),
      watch: (j.watch ?? []).map(String).filter((s) => allowed.has(s)).slice(0, 4),
      avoid: (j.avoid ?? []).map(String).filter((s) => allowed.has(s)).slice(0, 4),
      notes: clean(j.notes, 500),
      at: now.toISOString(),
    };
  }
  await setSetting(db, "trading_brief", brief);
  await tradingEvent(db, { agentSlug: "trading_news", message: `Morning brief: ${brief.headline || brief.mood}`, data: { kind: "brief", mood: brief.mood, headline: brief.headline }, at: now });
  return { status: "written", costUsd };
}

// The desk meeting

export interface MeetingResult {
  bull: string;
  bear: string;
  decision: "buy" | "pass";
  confidence: number;
  stop: number;
  target: number;
  sizeUsd: number;
  reason: string;
  costUsd: number;
  simulated: boolean;
}

const MEETING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bull: { type: "string" },
    bear: { type: "string" },
    decision: { type: "string", enum: ["buy", "pass"] },
    confidence: { type: "integer", enum: [1, 2, 3, 4, 5] },
    stop: { type: "number" },
    target: { type: "number" },
    sizeUsd: { type: "number" },
    reason: { type: "string" },
  },
  required: ["bull", "bear", "decision", "confidence", "stop", "target", "sizeUsd", "reason"],
};

function meetingSystem(lessons: string[]): string {
  return `You run a short desk meeting on a paper trading floor. Three voices speak, in this order:
Bull: the strongest honest case for buying now, in at most 30 words.
Bear: the strongest honest case against, in at most 30 words. Name the real risk.
Chief: decides buy or pass, picks the stop (under the price), the target (over the price) and the size in USD, and gives the reason in at most 30 words.

House rules, enforced in code anyway: long only, no borrowing, at most ${Math.round(RISK.maxPositionPct * 100)} percent of the desk in one trade, each trade risks about ${(RISK.riskPerTradePct * 100).toFixed(1)} percent of the desk, stop between ${(RISK.minStopPct * 100).toFixed(1)} and ${RISK.maxStopPct * 100} percent under the price, reward between ${RISK.minRewardRisk} and ${RISK.maxRewardRisk} times the risk.
The Chief is skeptical. Most signals are noise; pass is a good answer. Buy only when the setup, the trend and the news agree. Against an index fund that does nothing, every bad trade costs.
Crypto pays a 0.25 percent fee each way, so small moves are not worth it there.
${lessons.length ? `Lessons the Coach wrote from earlier trades:\n${lessons.map((l) => `• ${l}`).join("\n")}\n` : ""}Write in plain English. Never use dashes or hyphens as punctuation.`;
}

export async function deskMeeting(
  db: Db,
  input: { desk: Desk; signal: SignalIdea; plan: { stop: number; target: number }; open: Position[]; cashAvailable: number },
  now: Date,
  simulation: boolean,
): Promise<MeetingResult | null> {
  const { signal, plan, desk } = input;
  const sym = shortSymbol(signal.symbol);
  if (simulation) {
    const buy = signal.score >= 70 && signal.detail.trendUp !== false;
    return {
      bull: `${sym} shows a clean ${SIGNAL_WORDS[signal.kind]} with volume ${signal.detail.volRatio} times normal. Momentum is on our side.`,
      bear: signal.detail.trendUp === false ? `The bigger trend in ${sym} still points down. This bounce can fail fast.` : `RSI is ${signal.detail.rsi}. ${sym} could stall right here and stop us out.`,
      decision: buy ? "buy" : "pass",
      confidence: buy ? 3 : 2,
      stop: plan.stop,
      target: plan.target,
      sizeUsd: 20,
      reason: buy ? `Score ${signal.score} with the trend behind it. Small size, tight stop.` : `Score ${signal.score} is not enough. We wait for a better one.`,
      costUsd: 0,
      simulated: true,
    };
  }
  if (!(await canAfford(db, "meeting", now))) return null;
  const lessons = await getSetting<string[]>(db, "trading_lessons", []);
  const brief = await getSetting<MorningBrief | null>(db, "trading_brief", null);
  const news = await newsFor(db, signal.symbol, now);
  const d = signal.detail;
  const lines = [
    `Desk: ${desk.name} (${desk.market}), equity ${Number(desk.equityUsd).toFixed(2)} USD, settled cash ${input.cashAvailable.toFixed(2)} USD, open trades: ${input.open.map((p) => shortSymbol(p.symbol)).join(", ") || "none"}.`,
    `Signal: ${sym} ${SIGNAL_WORDS[signal.kind]}, score ${signal.score} of 100, price ${fmtPrice(signal.price)}.`,
    `Chart: RSI ${d.rsi}, fast average ${fmtPrice(d.emaFast)}, slow average ${fmtPrice(d.emaSlow)}, 30 minute ATR ${fmtPrice(d.atr30)}, volume ${d.volRatio} times normal, ${d.changePct} percent over the last ${signal.market === "stocks" ? "session" : "6 hours"}, ${d.trendUp === true ? "daily trend up" : d.trendUp === false ? "daily trend down" : "daily trend unknown"}${d.vwap ? `, VWAP ${fmtPrice(d.vwap)}` : ""}.`,
    `Default plan from volatility: stop ${fmtPrice(plan.stop)}, target ${fmtPrice(plan.target)}.`,
    news.length ? `News:\n${news.map((x) => `• ${x.headline}${x.sentiment ? ` (${x.sentiment}, impact ${x.impact ?? 1})` : ""}`).join("\n")}` : "News: nothing in the last day and a half.",
    brief && brief.dayKey === dubaiParts(now).dayKey ? `Today's brief: ${brief.mood}. ${brief.headline}. Watch ${brief.watch.join(", ") || "nothing special"}. Avoid ${brief.avoid.join(", ") || "nothing special"}. ${brief.notes}` : "No brief yet today.",
  ];
  const res = await callModel(db, { agentKey: "worker", agentId: await agentId(db, "trading_chief"), floorId: await floorId(db), system: meetingSystem(lessons), messages: [{ role: "user", content: lines.join("\n") }], schema: MEETING_SCHEMA, maxTokens: 900 }, now);
  const j = (res.json ?? {}) as Partial<MeetingResult>;
  const stop = Number(j.stop);
  const target = Number(j.target);
  return {
    bull: clean(j.bull, 240),
    bear: clean(j.bear, 240),
    decision: j.decision === "buy" ? "buy" : "pass",
    confidence: Math.max(1, Math.min(5, Math.round(Number(j.confidence) || 1))),
    stop: Number.isFinite(stop) && stop > 0 && stop < signal.price ? stop : plan.stop,
    target: Number.isFinite(target) && target > signal.price ? target : plan.target,
    sizeUsd: Number.isFinite(Number(j.sizeUsd)) ? Math.max(0, Number(j.sizeUsd)) : 0,
    reason: clean(j.reason, 240),
    costUsd: res.costUsd,
    simulated: false,
  };
}

// The Coach

const COACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lessons: { type: "array", items: { type: "object", additionalProperties: false, properties: { n: { type: "integer" }, lesson: { type: "string" } }, required: ["n", "lesson"] } },
    rule: { type: "string" },
  },
  required: ["lessons", "rule"],
};

const COACH_SYSTEM = `You are the Coach of a paper trading floor. After trades close you write what the desk should learn.
For each trade write one lesson of at most 20 plain words: what worked or what went wrong, judged by the reason it was taken, not only by the result. A good trade can lose and a bad one can win.
Then give one short rule of at most 15 words the desk should keep in mind from now on.
Write in plain English. Never use dashes or hyphens as punctuation.`;

export async function coachLessons(db: Db, now: Date, simulation: boolean): Promise<{ status: string; lessons: number; costUsd: number }> {
  const todo = await db
    .select()
    .from(tradingPositions)
    .where(and(eq(tradingPositions.status, "closed"), isNull(tradingPositions.lesson), isNotNull(tradingPositions.thesis)))
    .orderBy(asc(tradingPositions.closedAt))
    .limit(6);
  const worth = todo.filter((p) => p.signalId);
  // Larry's and time exits without a signal teach nothing new: mark them read
  for (const p of todo.filter((x) => !x.signalId)) await db.update(tradingPositions).set({ lesson: "" }).where(eq(tradingPositions.id, p.id));
  if (!worth.length) return { status: "nothing to learn", lessons: 0, costUsd: 0 };
  let lessons: Array<{ n: number; lesson: string }>;
  let rule = "";
  let costUsd = 0;
  if (simulation) {
    lessons = worth.map((p, i) => ({ n: i + 1, lesson: Number(p.pnlUsd) >= 0 ? "The plan worked: entry with the trend, exit at the plan." : "The stop did its job. The setup was weaker than the score said." }));
    rule = "Trade with the daily trend, never against it.";
  } else {
    if (!(await canAfford(db, "coach", now))) return { status: "no AI money left today", lessons: 0, costUsd: 0 };
    const list = worth
      .map((p, i) => `${i + 1}. ${shortSymbol(p.symbol)}: bought ${fmtPrice(Number(p.entryPrice))}, sold ${fmtPrice(Number(p.exitPrice))} (${p.exitReason}), ${Number(p.pnlUsd) >= 0 ? "won" : "lost"} ${Math.abs(Number(p.pnlUsd)).toFixed(2)} USD (${round(Number(p.pnlPct), 2)} percent). Why it was taken: ${p.thesis}`)
      .join("\n");
    const res = await callModel(db, { agentKey: "worker", agentId: await agentId(db, "trading_coach"), floorId: await floorId(db), system: COACH_SYSTEM, messages: [{ role: "user", content: `Closed trades:\n${list}` }], schema: COACH_SCHEMA, maxTokens: 900 }, now);
    costUsd = res.costUsd;
    const j = (res.json ?? {}) as { lessons?: typeof lessons; rule?: string };
    lessons = j.lessons ?? [];
    rule = clean(j.rule, 140);
  }
  let written = 0;
  for (const l of lessons) {
    const p = worth[l.n - 1];
    if (!p) continue;
    await db.update(tradingPositions).set({ lesson: clean(l.lesson, 200) }).where(eq(tradingPositions.id, p.id));
    written += 1;
  }
  for (const p of worth) await db.update(tradingPositions).set({ lesson: "" }).where(and(eq(tradingPositions.id, p.id), isNull(tradingPositions.lesson)));
  if (rule) {
    const kept = await getSetting<string[]>(db, "trading_lessons", []);
    await setSetting(db, "trading_lessons", [rule, ...kept.filter((x) => x !== rule)].slice(0, 12));
    await tradingEvent(db, { agentSlug: "trading_coach", message: `Coach: ${rule}`, data: { kind: "lesson", rule }, at: now });
  }
  return { status: "written", lessons: written, costUsd };
}

export function marketWords(m: Market): string {
  return m === "stocks" ? "stocks" : "crypto";
}
