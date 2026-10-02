// The AI half of Wall Street (D075): the News Hound reads headlines, the desk meeting (Bull, Bear and the
// Chief) decides on a signal, the morning brief sets the day's mood and the Coach writes a lesson after trades.
// Every call goes through the model wrapper and fits inside the floor's own daily money and the Tower's cap.
// In simulation mode nobody calls a model: the same jobs run on simple rules (rule 4).
import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { callModel } from "@/agents/client";
import { budgetLeftUsd } from "@/agents/spend-guard";
import { AI_COST_USD, CRYPTO_WATCHLIST, FIRM, RISK, STOCK_WATCHLIST, TRADING_DAILY_USD, sectorOf, type Market } from "@/config/trading";
import type { Db } from "@/db/client";
import { agents, floors, tradingNews, tradingPositions, tradingSignals } from "@/db/schema";
import { getSpendSummary } from "@/lib/budget";
import type { MarketData } from "@/lib/market";
import { asNumber, getSetting, getSettings, setSetting } from "@/lib/settings";
import { plainDashes } from "@/lib/text";
import { dubaiDayStartUtc, dubaiParts } from "@/lib/time";
import { trackRecordLine, voiceRecords } from "./learn";
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

// The trading room (Saaqib's design, 2026-10-01): seven AI voices, each seeing only its own piece. Hound
// (news), Quant (chart) and Strategist (market mood) speak at the same time; then the Bull answers them, the
// Bear attacks the Bull, the Risk Officer sizes it and the Chief decides and names whose argument decided it.
// Hard limits stay in code: the Risk Officer's size is a ceiling the Chief cannot pass, and riskCheck clamps all.

export type Voice = "Hound" | "Quant" | "Strategist" | "Bull" | "Bear" | "Risk Officer" | "Chief";

export interface RoomVoice {
  who: Voice;
  say: string;
  vote: "buy" | "pass";
  confidence: number;
}

export interface MeetingResult {
  voices: RoomVoice[];
  votes: { buy: number; pass: number };
  decision: "buy" | "pass";
  stop: number;
  target: number;
  sizeUsd: number;
  riskMaxUsd: number | null;
  reason: string;
  decidedBy: Voice;
  costUsd: number;
  simulated: boolean;
}

const VOICE_AGENT: Record<Voice, string> = {
  Hound: "trading_news",
  Quant: "trading_quant",
  Strategist: "trading_strategist",
  Bull: "trading_bull",
  Bear: "trading_bear",
  "Risk Officer": "trading_risk",
  Chief: "trading_chief",
};

const VOTE = { type: "string", enum: ["buy", "pass"] };
const CONF = { type: "integer", enum: [1, 2, 3, 4, 5] };
function voiceSchema(extra: Record<string, unknown> = {}) {
  return {
    type: "object",
    additionalProperties: false,
    properties: { say: { type: "string" }, vote: VOTE, confidence: CONF, ...extra },
    required: ["say", "vote", "confidence", ...Object.keys(extra)],
  };
}
const CHIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: VOTE,
    sizeUsd: { type: "number" },
    stop: { type: "number" },
    target: { type: "number" },
    reason: { type: "string" },
    decidedBy: { type: "string", enum: ["Hound", "Quant", "Strategist", "Bull", "Bear", "Risk Officer", "Chief"] },
  },
  required: ["decision", "sizeUsd", "stop", "target", "reason", "decidedBy"],
};

function houseRules(equity: number): string {
  return `HOUSE RULES (every agent gets these)
You are one of seven people in a trading room on a paper money floor.
The desk has ${equity.toFixed(2)} USD. Long only, no borrowing. Hard risk limits are enforced by code: at most ${Math.round(RISK.maxPositionPct * 100)} percent of the desk in one trade, a stop between ${(RISK.minStopPct * 100).toFixed(1)} and ${RISK.maxStopPct * 100} percent under the price, a target between ${RISK.minRewardRisk} and ${RISK.maxRewardRisk} times the risk.
Say at most 35 plain words. Use the numbers you are given. Be specific and honest.
Disagree when you see it differently. Agreeing just to agree is a failure.
Never use dashes or hyphens as punctuation.`;
}

const ROLE: Record<Voice, string> = {
  Hound: "HOUND, news analyst (you see only the news). Read the headlines for the symbol. Say what they mean for the price today, whether the news is already priced in, and anything due soon such as earnings or data. Vote.",
  Quant: "QUANT, chart analyst (you see only the chart numbers). Read the trend, RSI, volume, volatility and the signal score. Say if the setup is clean or noise, and where a sensible stop would sit (give it as stop, a price under the current price). Vote.",
  Strategist: "STRATEGIST, market mood (you see the morning brief and the whole market). Say whether today's market and sector tide helps or fights this trade. Vote.",
  Bull: "BULL (you read the three analysts). Make the strongest honest case for buying now. Answer the weakest point the analysts raised against it. Vote.",
  Bear: "BEAR (you read the analysts and the Bull). Attack the Bull's case. Name the one thing most likely to make this trade lose. If the case is truly strong, say what would change your mind. Vote.",
  "Risk Officer": "RISK OFFICER (you read everything). Say how much of the desk's money fits this risk (give it as maxSizeUsd), where the stop must go (give it as stop, under the price), and what happens if the price gaps through it. You may call for smaller size or a veto (vote pass).",
  Chief: "CHIEF (you read every voice and the votes). You run the room. Decide buy or pass, the size in USD, the stop and the target. Explain in at most 35 words and name whose argument decided it. Pass is a good answer. If the room is split, side with caution unless the Bull answered the Bear's best point. Never size above the Risk Officer's maxSizeUsd.",
};

function voiceLine(v: RoomVoice, extra = ""): string {
  return `${v.who} (votes ${v.vote}, confidence ${v.confidence}${extra}): ${v.say}`;
}

export async function deskMeeting(
  db: Db,
  input: { desk: Desk; signal: SignalIdea; plan: { stop: number; target: number }; open: Position[]; cashAvailable: number; tape?: Array<{ s: string; chg: number | null }> },
  now: Date,
  simulation: boolean,
): Promise<MeetingResult | null> {
  const { signal, plan, desk } = input;
  const sym = shortSymbol(signal.symbol);
  const d = signal.detail;
  const equity = Number(desk.equityUsd);
  if (simulation) return simulatedRoom(input, sym);
  if (!(await canAfford(db, "meeting", now))) return null;
  const fid = await floorId(db);
  const lessons = await getSetting<string[]>(db, "trading_lessons", []);
  const brief = await getSetting<MorningBrief | null>(db, "trading_brief", null);
  const news = await newsFor(db, signal.symbol, now);
  const rules = houseRules(equity);
  let costUsd = 0;

  // six voices on the worker model; the Chief, who decides, on the strongest one
  const ask = async (who: Voice, facts: string, schema: Record<string, unknown>, maxTokens = 500) => {
    const res = await callModel(db, { agentKey: who === "Chief" ? "warden" : "worker", agentId: await agentId(db, VOICE_AGENT[who]), floorId: fid, system: `${rules}\n\n${ROLE[who]}`, messages: [{ role: "user", content: facts }], schema, maxTokens: who === "Chief" ? 1500 : maxTokens }, now);
    costUsd += res.costUsd;
    return (res.json ?? {}) as Record<string, unknown>;
  };
  const asVoice = (who: Voice, j: Record<string, unknown>): RoomVoice => ({
    who,
    say: clean(j.say, 260) || "No comment.",
    vote: j.vote === "buy" ? "buy" : "pass",
    confidence: Math.max(1, Math.min(5, Math.round(Number(j.confidence) || 1))),
  });
  const head = `Symbol: ${sym} (${signal.market === "stocks" ? "US stock" : "crypto"}), price ${fmtPrice(signal.price)}.`;

  // Round 1: three analysts at once, each with only their own facts
  const newsFacts = news.length
    ? news.map((x) => `• ${x.headline}${x.sentiment ? ` (tagged ${x.sentiment}, impact ${x.impact ?? 1})` : ""}`).join("\n")
    : "No headlines for this symbol in the last 36 hours.";
  const chartFacts = [
    `Signal: ${SIGNAL_WORDS[signal.kind]}, score ${signal.score} of 100.`,
    `RSI ${d.rsi}. Fast average ${fmtPrice(d.emaFast)}, slow average ${fmtPrice(d.emaSlow)}. 30 minute ATR ${fmtPrice(d.atr30)}. Volume ${d.volRatio} times normal.`,
    `${d.changePct} percent over the last ${signal.market === "stocks" ? "session" : "6 hours"}. ${d.trendUp === true ? "Daily trend up (over its 50 day average)." : d.trendUp === false ? "Daily trend down (under its 50 day average)." : "Daily trend unknown."}${d.vwap ? ` VWAP ${fmtPrice(d.vwap)}.` : ""}`,
    `Stop from volatility would be ${fmtPrice(plan.stop)}.`,
  ].join("\n");
  const tape = (input.tape ?? []).filter((t) => ["SPY", "QQQ", "IWM", "XLE", "XLF", "BTC", "ETH", "SOL"].includes(t.s));
  const plan_ = await todaysPlan(db, now);
  const planLine = plan_ ? `Today's desk plan from the morning meeting: ${plan_.mode} day. ${plan_.plan} Focus ${plan_.focus.join(", ") || "none"}. Avoid ${plan_.avoid.join(", ") || "none"}.` : "No morning meeting yet today.";
  const moodFacts = [
    planLine,
    brief && brief.dayKey === dubaiParts(now).dayKey ? `Morning brief: mood ${brief.mood}. ${brief.headline}. Watch ${brief.watch.join(", ") || "nothing special"}. Avoid ${brief.avoid.join(", ") || "nothing special"}. ${brief.notes}` : "No morning brief today.",
    tape.length ? `Market today: ${tape.map((t) => `${t.s} ${t.chg === null ? "flat" : `${t.chg >= 0 ? "up" : "down"} ${Math.abs(t.chg).toFixed(2)} percent`}`).join(", ")}.` : "No market snapshot.",
  ].join("\n");
  const [hj, qj, sj] = await Promise.all([
    ask("Hound", `${head}\nHeadlines:\n${newsFacts}`, voiceSchema()),
    ask("Quant", `${head}\n${chartFacts}`, voiceSchema({ stop: { type: "number" } })),
    ask("Strategist", `${head}\n${moodFacts}`, voiceSchema()),
  ]);
  const hound = asVoice("Hound", hj);
  const quant = asVoice("Quant", qj);
  const strat = asVoice("Strategist", sj);
  const quantStop = Number(qj.stop);
  const analysts = [voiceLine(hound), voiceLine(quant, Number.isFinite(quantStop) ? `, stop ${fmtPrice(quantStop)}` : ""), voiceLine(strat)].join("\n");

  // Rounds 2 to 4: the Bull answers the analysts, the Bear attacks the Bull, the Risk Officer sizes it
  const bull = asVoice("Bull", await ask("Bull", `${head}\nThe analysts:\n${analysts}`, voiceSchema()));
  const bear = asVoice("Bear", await ask("Bear", `${head}\nThe analysts:\n${analysts}\n${voiceLine(bull)}`, voiceSchema()));
  const sector = sectorOf(signal.symbol);
  const sameSector = input.open.filter((p) => sectorOf(p.symbol) === sector).map((p) => shortSymbol(p.symbol));
  const deskFacts = `Desk ${desk.name}: equity ${equity.toFixed(2)} USD, settled cash ${input.cashAvailable.toFixed(2)} USD, open trades ${input.open.map((p) => `${shortSymbol(p.symbol)} (${sectorOf(p.symbol)})`).join(", ") || "none"}. ${sym} is ${sector}${sameSector.length ? `, the desk already holds ${sameSector.join(" and ")} there (limit ${RISK.maxPerSector} per sector)` : ""}. A trade at the volatility stop risks about ${(RISK.riskPerTradePct * 100).toFixed(1)} percent of the desk. 30 minute ATR ${fmtPrice(d.atr30)}.${signal.market === "crypto" ? ` Crypto pays a 0.25 percent fee each way, so the target must clear ${(RISK.cryptoMinTargetPct * 100).toFixed(1)} percent and ${RISK.cryptoMinRewardRisk} times the risk.` : ""}`;
  const rj = await ask("Risk Officer", `${head}\n${deskFacts}\n${chartFacts}\nThe room so far:\n${analysts}\n${voiceLine(bull)}\n${voiceLine(bear)}`, voiceSchema({ maxSizeUsd: { type: "number" }, stop: { type: "number" } }));
  const risk = asVoice("Risk Officer", rj);
  const riskMax = Number(rj.maxSizeUsd);
  const riskStop = Number(rj.stop);
  const voices = [hound, quant, strat, bull, bear, risk];
  const votes = { buy: voices.filter((v) => v.vote === "buy").length, pass: voices.filter((v) => v.vote === "pass").length };

  // Round 5: the Chief decides, with every voice's record and the day's earlier decisions in mind
  const records = trackRecordLine(await voiceRecords(db));
  const earlier = await db
    .select({ symbol: tradingSignals.symbol, meeting: tradingSignals.meeting, decidedAt: tradingSignals.decidedAt })
    .from(tradingSignals)
    .where(and(eq(tradingSignals.deskSlug, desk.slug), gte(tradingSignals.decidedAt, dubaiDayStartUtc(now)), isNotNull(tradingSignals.meeting)))
    .orderBy(desc(tradingSignals.decidedAt))
    .limit(8);
  const dayLine = earlier.length
    ? `Today's decisions on this desk so far: ${earlier
        .map((e) => {
          const m = (e.meeting ?? {}) as { decision?: string; decidedBy?: string };
          return `${shortSymbol(e.symbol)} ${m.decision === "buy" ? "BUY" : "PASS"}${m.decidedBy ? ` (${m.decidedBy})` : ""}`;
        })
        .join(", ")}. Do not re-argue the same symbol unless something changed.`
    : "";
  const cj = await ask(
    "Chief",
    `${head}\n${deskFacts}\n${[records, dayLine].filter(Boolean).join("\n")}${records || dayLine ? "\n" : ""}Every voice:\n${voices.map((v) => voiceLine(v, v.who === "Risk Officer" ? `, max size ${Number.isFinite(riskMax) ? riskMax.toFixed(2) : "not given"} USD, stop ${Number.isFinite(riskStop) ? fmtPrice(riskStop) : "not given"}` : v.who === "Quant" && Number.isFinite(quantStop) ? `, stop ${fmtPrice(quantStop)}` : "")).join("\n")}\nVotes: ${votes.buy} buy, ${votes.pass} pass.\n${planLine}\nVolatility plan: stop ${fmtPrice(plan.stop)}, target ${fmtPrice(plan.target)}.${lessons.length ? `\nLessons the Coach wrote from earlier trades:\n${lessons.slice(0, 6).map((l) => `• ${l}`).join("\n")}` : ""}`,
    CHIEF_SCHEMA,
    600,
  );
  const decision = cj.decision === "buy" ? "buy" : "pass";
  const below = (v: number) => Number.isFinite(v) && v > 0 && v < signal.price;
  // the safest of the stops the room named: the highest one under the price
  const stops = [Number(cj.stop), riskStop].filter(below);
  const stop = stops.length ? Math.max(...stops) : plan.stop;
  const target = Number.isFinite(Number(cj.target)) && Number(cj.target) > signal.price ? Number(cj.target) : plan.target;
  const ceiling = Number.isFinite(riskMax) && riskMax > 0 ? riskMax : null;
  const asked = Number.isFinite(Number(cj.sizeUsd)) ? Math.max(0, Number(cj.sizeUsd)) : 0;
  const decidedBy = (typeof cj.decidedBy === "string" && cj.decidedBy in VOICE_AGENT ? cj.decidedBy : "Chief") as Voice;
  const chief: RoomVoice = { who: "Chief", say: clean(cj.reason, 260), vote: decision, confidence: 0 };
  return {
    voices: [...voices, chief],
    votes,
    decision,
    stop,
    target,
    sizeUsd: ceiling !== null ? Math.min(asked, ceiling) : asked,
    riskMaxUsd: ceiling,
    reason: chief.say,
    decidedBy,
    costUsd,
    simulated: false,
  };
}

// The same room on simple rules, for simulation mode (rule 4).
function simulatedRoom(input: { signal: SignalIdea; plan: { stop: number; target: number } }, sym: string): MeetingResult {
  const { signal, plan } = input;
  const d = signal.detail;
  const trendOk = d.trendUp !== false;
  const voices: RoomVoice[] = [
    { who: "Hound", say: `Nothing big on ${sym} in the headlines. No earnings due this week, so the chart leads.`, vote: "pass", confidence: 2 },
    { who: "Quant", say: `Clean ${SIGNAL_WORDS[signal.kind]}, score ${signal.score}, volume ${d.volRatio} times normal. Stop near ${fmtPrice(plan.stop)}.`, vote: signal.score >= 70 ? "buy" : "pass", confidence: 3 },
    { who: "Strategist", say: trendOk ? "The tide is with us today. Leaders are green." : `The daily trend in ${sym} still points down. The tide fights this.`, vote: trendOk ? "buy" : "pass", confidence: 3 },
    { who: "Bull", say: `Volume confirms the move and the trend agrees. No news means no surprise against us.`, vote: "buy", confidence: 3 },
    { who: "Bear", say: `RSI ${d.rsi} leaves little room. One bar of volume is not a trend.`, vote: "pass", confidence: 3 },
    { who: "Risk Officer", say: `Twenty USD fits. Stop at ${fmtPrice(plan.stop)}; a gap through it costs about one dollar more.`, vote: trendOk ? "buy" : "pass", confidence: 3 },
  ];
  const votes = { buy: voices.filter((v) => v.vote === "buy").length, pass: voices.filter((v) => v.vote === "pass").length };
  const buy = votes.buy > votes.pass && signal.score >= 70;
  const reason = buy ? "The Bull answered the Bear: volume backs the move. Small size." : "The room is split and the Bear's point stands. We wait.";
  return { voices: [...voices, { who: "Chief", say: reason, vote: buy ? "buy" : "pass", confidence: 0 }], votes, decision: buy ? "buy" : "pass", stop: plan.stop, target: plan.target, sizeUsd: 20, riskMaxUsd: 20, reason, decidedBy: buy ? "Bull" : "Bear", costUsd: 0, simulated: true };
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

// The firm's day (D075): the morning meeting, position reviews and the desk notes at the close.

export interface DeskPlan {
  dayKey: string;
  mode: "careful" | "normal" | "bold";
  focus: string[];
  avoid: string[];
  plan: string;
  strategist: string;
  at: string;
}

export async function todaysPlan(db: Db, now: Date): Promise<DeskPlan | null> {
  const p = await getSetting<DeskPlan | null>(db, "trading_plan", null);
  return p && p.dayKey === dubaiParts(now).dayKey ? p : null;
}

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["careful", "normal", "bold"] },
    focus: { type: "array", items: { type: "string" } },
    avoid: { type: "array", items: { type: "string" } },
    plan: { type: "string" },
  },
  required: ["mode", "focus", "avoid", "plan"],
};

const MORNING_STRATEGIST = `MORNING MEETING. You are the STRATEGIST of a small paper trading firm (US stocks and crypto, long only).
From the morning brief, the market numbers and how the desks did, say in at most 45 plain words what kind of day this is and where the edge is, if anywhere.
Write in plain English. Never use dashes or hyphens as punctuation.`;

const MORNING_CHIEF = `MORNING MEETING. You are the CHIEF of a small paper trading firm (US stocks and crypto, long only). Hard limits are enforced by code.
Set today's plan for the desk: the mode (careful, normal or bold), up to 5 symbols to focus on, up to 5 to avoid, and the plan in at most 40 plain words.
Careful days take smaller trades and only the strongest setups. Bold never means past the limits. Losing streaks and messy markets call for careful.
Only use symbols from this watchlist: ${[...STOCK_WATCHLIST, ...CRYPTO_WATCHLIST].join(", ")}.
Write in plain English. Never use dashes or hyphens as punctuation.`;

// Once a Dubai day from FIRM.morningHourDubai, after the brief: the Strategist reads the day, the Chief sets the plan.
export async function morningMeeting(db: Db, now: Date, simulation: boolean, input: { tape: Array<{ s: string; chg: number | null }>; desks: string[] }): Promise<{ status: string; costUsd: number }> {
  const p = dubaiParts(now);
  if (await todaysPlan(db, now)) return { status: "done today", costUsd: 0 };
  if (p.hour < FIRM.morningHourDubai) return { status: "not yet", costUsd: 0 };
  const brief = await getSetting<MorningBrief | null>(db, "trading_brief", null);
  const briefLine = brief && brief.dayKey === p.dayKey ? `Brief: ${brief.mood}. ${brief.headline}. Watch ${brief.watch.join(", ") || "nothing special"}. Avoid ${brief.avoid.join(", ") || "nothing special"}. ${brief.notes}` : "No brief today.";
  const tapeLine = input.tape.length ? `Market: ${input.tape.map((t) => `${t.s} ${t.chg === null ? "flat" : `${t.chg >= 0 ? "up" : "down"} ${Math.abs(t.chg).toFixed(2)} percent`}`).join(", ")}.` : "No market numbers.";
  const lessons = await getSetting<string[]>(db, "trading_lessons", []);
  const memo = await getSetting<{ memo: string } | null>(db, "trading_memo", null);
  const facts = [briefLine, tapeLine, `The desks: ${input.desks.join("; ")}.`, memo?.memo ? `The Coach's memo for this week: ${memo.memo}` : "", lessons.length ? `Coach's lessons: ${lessons.slice(0, 4).join(" ")}` : ""].filter(Boolean).join("\n");
  let plan: DeskPlan;
  let costUsd = 0;
  if (simulation) {
    const mode = brief?.mood === "bearish" ? "careful" : brief?.mood === "bullish" ? "bold" : "normal";
    plan = { dayKey: p.dayKey, mode, focus: brief?.watch ?? [], avoid: brief?.avoid ?? [], plan: mode === "careful" ? "Small size, only the cleanest setups. Cash is fine today." : "Trade the leaders with the trend. Cut losers fast.", strategist: "A made up market today. The tide follows the brief.", at: now.toISOString() };
  } else {
    if (!(await canAfford(db, "morning", now))) return { status: "no AI money left today", costUsd: 0 };
    const fid = await floorId(db);
    const sres = await callModel(db, { agentKey: "worker", agentId: await agentId(db, "trading_strategist"), floorId: fid, system: MORNING_STRATEGIST, messages: [{ role: "user", content: facts }], maxTokens: 500 }, now);
    const strategist = clean(sres.text, 300);
    const cres = await callModel(db, { agentKey: "warden", agentId: await agentId(db, "trading_chief"), floorId: fid, system: MORNING_CHIEF, messages: [{ role: "user", content: `${facts}\nStrategist: ${strategist}` }], schema: PLAN_SCHEMA, maxTokens: 1500 }, now);
    costUsd = sres.costUsd + cres.costUsd;
    const j = (cres.json ?? {}) as Partial<DeskPlan>;
    const allowed = new Set([...STOCK_WATCHLIST, ...CRYPTO_WATCHLIST]);
    plan = {
      dayKey: p.dayKey,
      mode: j.mode === "careful" || j.mode === "bold" ? j.mode : "normal",
      focus: (j.focus ?? []).map(String).filter((x) => allowed.has(x)).slice(0, 5),
      avoid: (j.avoid ?? []).map(String).filter((x) => allowed.has(x)).slice(0, 5),
      plan: clean(j.plan, 280),
      strategist,
      at: now.toISOString(),
    };
  }
  await setSetting(db, "trading_plan", plan);
  await tradingEvent(db, { agentSlug: "trading_chief", message: `Morning meeting: a ${plan.mode} day. ${plan.plan}`, data: { kind: "morning", mode: plan.mode, plan: plan.plan, strategist: plan.strategist, focus: plan.focus, avoid: plan.avoid }, at: now });
  return { status: "held", costUsd };
}

export interface ReviewResult {
  voices: RoomVoice[];
  action: "hold" | "tighten" | "close";
  stop: number | null;
  reason: string;
  decidedBy: Voice;
  costUsd: number;
}

const REVIEW_CHIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["hold", "tighten", "close"] },
    stop: { type: "number" },
    reason: { type: "string" },
    decidedBy: { type: "string", enum: ["Hound", "Quant", "Risk Officer", "Chief"] },
  },
  required: ["action", "stop", "reason", "decidedBy"],
};

const REVIEW_ROLE: Record<"Hound" | "Quant" | "Risk Officer" | "Chief", string> = {
  Hound: "POSITION REVIEW. HOUND, news analyst. Has any news since the trade opened changed the reason we hold it? Vote buy to keep holding, pass to get out.",
  Quant: "POSITION REVIEW. QUANT, chart analyst. Is the move still healthy or fading? Where should the stop be now? Vote buy to keep holding, pass to get out.",
  "Risk Officer": "POSITION REVIEW. RISK OFFICER. Is the stop in the right place for what we can lose? What happens on a gap? Vote buy to keep holding, pass to get out.",
  Chief: "POSITION REVIEW. CHIEF. Decide: hold, tighten the stop (give the new stop, under the price and never lower than the current stop) or close now. Explain in at most 30 words and name whose argument decided it. Give stop as the current stop when you hold or close.",
};

// The desk looks at one open trade again, like a firm does through the day: hold, tighten the stop or close.
export async function positionReview(db: Db, input: { position: Position; deskName: string; last: number; equity: number }, now: Date, simulation: boolean): Promise<ReviewResult | null> {
  const p = input.position;
  const sym = shortSymbol(p.symbol);
  const entry = Number(p.entryPrice);
  const stop = p.stopPrice === null ? null : Number(p.stopPrice);
  const target = p.targetPrice === null ? null : Number(p.targetPrice);
  const pnlPct = ((input.last - entry) / entry) * 100;
  const hours = Math.max(0, (now.getTime() - p.openedAt.getTime()) / 3600_000);
  if (simulation) {
    const fading = pnlPct < -0.6;
    const winning = pnlPct > 0.8 && stop !== null && stop < entry;
    const action: ReviewResult["action"] = fading ? "close" : winning ? "tighten" : "hold";
    return {
      voices: [
        { who: "Quant", say: fading ? `${sym} lost its push. Below the entry with no volume.` : `${sym} holds its trend. Nothing broken.`, vote: fading ? "pass" : "buy", confidence: 3 },
        { who: "Risk Officer", say: winning ? `Move the stop to the entry. A winner must not turn into a loser.` : `Stop is fine where it is.`, vote: "buy", confidence: 3 },
      ],
      action,
      stop: action === "tighten" ? entry : stop,
      reason: action === "close" ? "The reason we bought is gone. Out now." : action === "tighten" ? "Lock in a free trade. Stop to the entry." : "Thesis intact. Hold.",
      decidedBy: action === "close" ? "Quant" : action === "tighten" ? "Risk Officer" : "Chief",
      costUsd: 0,
    };
  }
  if (!(await canAfford(db, "review", now))) return null;
  const fid = await floorId(db);
  const head = `Open trade on ${input.deskName}: ${sym}, bought ${fmtPrice(entry)} for ${Number(p.costUsd).toFixed(2)} USD, ${hours.toFixed(1)} hours ago. Now ${fmtPrice(input.last)} (${pnlPct >= 0 ? "up" : "down"} ${Math.abs(pnlPct).toFixed(2)} percent). Stop ${stop === null ? "none" : fmtPrice(stop)}, target ${target === null ? "none" : fmtPrice(target)}. Why we bought: ${p.thesis ?? "not recorded"}.`;
  const news = await newsFor(db, p.symbol, now);
  const newsLine = news.length ? `Headlines:\n${news.map((x) => `• ${x.headline}`).join("\n")}` : "No headlines since.";
  const rules = houseRules(input.equity);
  let costUsd = 0;
  const ask = async (who: "Hound" | "Quant" | "Risk Officer", facts: string) => {
    const res = await callModel(db, { agentKey: "worker", agentId: await agentId(db, VOICE_AGENT[who]), floorId: fid, system: `${rules}\n\n${REVIEW_ROLE[who]}`, messages: [{ role: "user", content: facts }], schema: voiceSchema(), maxTokens: 400 }, now);
    costUsd += res.costUsd;
    const j = (res.json ?? {}) as Record<string, unknown>;
    return { who, say: clean(j.say, 240) || "No comment.", vote: j.vote === "buy" ? "buy" : "pass", confidence: Math.max(1, Math.min(5, Math.round(Number(j.confidence) || 1))) } as RoomVoice;
  };
  const voices = await Promise.all([ask("Hound", `${head}\n${newsLine}`), ask("Quant", head), ask("Risk Officer", head)]);
  const cres = await callModel(db, { agentKey: "warden", agentId: await agentId(db, "trading_chief"), floorId: fid, system: `${rules}\n\n${REVIEW_ROLE.Chief}`, messages: [{ role: "user", content: `${head}\n${voices.map((v) => voiceLine(v)).join("\n")}` }], schema: REVIEW_CHIEF_SCHEMA, maxTokens: 1200 }, now);
  costUsd += cres.costUsd;
  const j = (cres.json ?? {}) as Record<string, unknown>;
  let action: ReviewResult["action"] = j.action === "close" ? "close" : j.action === "tighten" ? "tighten" : "hold";
  const newStop = Number(j.stop);
  // a tighter stop only: higher than today's, under the price
  if (action === "tighten" && !(Number.isFinite(newStop) && newStop < input.last && (stop === null || newStop > stop))) action = "hold";
  return {
    voices,
    action,
    stop: action === "tighten" ? newStop : stop,
    reason: clean(j.reason, 240),
    decidedBy: (["Hound", "Quant", "Risk Officer", "Chief"].includes(String(j.decidedBy)) ? j.decidedBy : "Chief") as Voice,
    costUsd,
  };
}

const NOTES_SYSTEM = `END OF DAY. You are the COACH of a small paper trading firm. Write the desk notes for the owner in at most 70 plain words: what the desks did today, what worked, what did not, and one thing to do differently tomorrow. Be honest, use the numbers, compare with Lazy Larry who just holds the index.
Write in plain English. Never use dashes or hyphens as punctuation.`;

// The desk notes for the close report.
export async function deskNotes(db: Db, facts: string, now: Date, simulation: boolean): Promise<string | null> {
  if (simulation) return "A made up day. The desks traded the simulation; tomorrow the real market decides.";
  if (!(await canAfford(db, "wrap", now))) return null;
  const res = await callModel(db, { agentKey: "worker", agentId: await agentId(db, "trading_coach"), floorId: await floorId(db), system: NOTES_SYSTEM, messages: [{ role: "user", content: facts }], maxTokens: 600 }, now);
  const notes = clean(res.text, 600);
  if (notes) await tradingEvent(db, { agentSlug: "trading_coach", message: `Desk notes: ${notes}`, data: { kind: "wrap", notes }, at: now });
  return notes || null;
}

const MEMO_SYSTEM = `WEEKLY REVIEW. You are the COACH of a small paper trading firm. From the week's numbers write the memo that opens every morning meeting next week, at most 90 plain words: what the firm does well, what it should stop doing, which voices to trust more, which signal kinds to doubt, and one rule for the week. Honest, specific, numbers first.
Write in plain English. Never use dashes or hyphens as punctuation.`;

// The Coach's Sunday memo: kept for the week and read out at every morning meeting.
export async function firmMemo(db: Db, facts: string, now: Date, simulation: boolean): Promise<string | null> {
  const weekKey = dubaiParts(now).dayKey;
  if (simulation) {
    const memo = "A made up week. Keep the stops tight and trust the trend.";
    await setSetting(db, "trading_memo", { weekKey, memo, at: now.toISOString() });
    return memo;
  }
  if (!(await canAfford(db, "wrap", now))) return null;
  const res = await callModel(db, { agentKey: "worker", agentId: await agentId(db, "trading_coach"), floorId: await floorId(db), system: MEMO_SYSTEM, messages: [{ role: "user", content: facts }], maxTokens: 700 }, now);
  const memo = clean(res.text, 700);
  if (!memo) return null;
  await setSetting(db, "trading_memo", { weekKey, memo, at: now.toISOString() });
  await tradingEvent(db, { agentSlug: "trading_coach", message: `Memo for the week: ${memo}`, data: { kind: "memo", memo }, at: now });
  return memo;
}
