// Wall Street's pulse (D075), every few minutes: prices, the Executor, Larry, the marks and the bench, the
// scanner, the Quant Bot, the desk meetings, the News Hound, the morning brief, the Coach and the reports.
// Code does the fast work for free; the model only speaks in meetings, on news and after trades, inside the
// floor's own daily money. Paper money only: no step can reach a broker.
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { CRYPTO_BENCHMARK, CRYPTO_WATCHLIST, DESKS, PULSE_GAP_MS, PULSE_LOCK_MS, RISK, SCAN, STOCK_WATCHLIST, type Market } from "@/config/trading";
import type { Db } from "@/db/client";
import { agents, approvals, budgetLedger, floors, settings, tradingSignals } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { getSpendSummary } from "@/lib/budget";
import { getMarket, MarketError, usSessionClock, nyParts, type Bar, type MarketClock, type MarketData, type Quote } from "@/lib/market";
import { asBool, asNumber, getSetting, getSettings, setSetting } from "@/lib/settings";
import { enqueueMessage, getTelegramConfig } from "@/lib/telegram";
import { dubaiDayStartUtc, dubaiParts, dubaiWeekStartUtc } from "@/lib/time";
import { aiBudget, coachLessons, deskMeeting, fetchNews, houndTags, morningBrief } from "./crew";
import { availableCash, deskBySlug, ensureDesks, fmtPrice, larryBuys, markDesks, openPosition, openPositions, runExecutor, shortSymbol, snapshotEquity, tradingEvent } from "./engine";
import { sma } from "./indicators";
import { btcHoldPct, closeReport } from "./report";
import { defaultPlan, scanSymbol, SIGNAL_WORDS, type SignalIdea } from "./scanner";

const LOCK_KEY = "trading_lock";

async function acquire(db: Db, holder: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - PULSE_LOCK_MS);
  const value = { holder, at: now.toISOString() };
  const rows = await db
    .insert(settings)
    .values({ key: LOCK_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now }, setWhere: sql`${settings.updatedAt} < ${cutoff.toISOString()}` })
    .returning({ key: settings.key });
  return rows.length > 0;
}

async function release(db: Db, holder: string) {
  await db.update(settings).set({ value: { holder: null, at: null }, updatedAt: new Date(0) }).where(and(eq(settings.key, LOCK_KEY), sql`${settings.value}->>'holder' = ${holder}`));
}

export interface PulseResult {
  status: "ran" | "fresh" | "busy" | "off";
  at: string;
  steps: Record<string, unknown>;
}

// Runs one pulse when the last one is older than the gap. Safe to knock often from any clock.
export async function runTradingPulse(db: Db, now = new Date(), opts: { force?: boolean } = {}): Promise<PulseResult> {
  const last = await getSetting<string | null>(db, "trading_pulse_at", null);
  if (!opts.force && last && now.getTime() - new Date(last).getTime() < PULSE_GAP_MS) return { status: "fresh", at: now.toISOString(), steps: {} };
  const holder = randomUUID();
  if (!(await acquire(db, holder, now))) return { status: "busy", at: now.toISOString(), steps: {} };
  try {
    await setSetting(db, "trading_pulse_at", now.toISOString());
    return await pulseBody(db, now);
  } finally {
    await release(db, holder).catch(() => undefined);
  }
}

export interface TapeItem {
  s: string;
  p: number;
  chg: number | null;
  m: Market;
}

async function pulseBody(db: Db, now: Date): Promise<PulseResult> {
  const steps: Record<string, unknown> = {};
  const errors: string[] = [];
  const s = await getSettings(db);
  const simulation = asBool(s.simulation_mode, true);
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "trading")).limit(1);
  if (!floor || floor.status === "archived" || floor.status === "locked") return { status: "off", at: now.toISOString(), steps: { reason: "no live trading floor" } };
  const ownerPaused = floor.status === "paused" && !/^Daily cap/.test(floor.pausedReason ?? "");
  const market = await getMarket(db, simulation);
  await ensureDesks(db, simulation, now);

  // 1. The clock and the prices
  let clock: MarketClock;
  try {
    clock = await market.clock(now);
  } catch (err) {
    clock = usSessionClock(now);
    errors.push(`clock: ${msg(err)}`);
  }
  const held = await openPositions(db);
  const stockSymbols = [...new Set([...STOCK_WATCHLIST, ...held.filter((p) => p.market === "stocks").map((p) => p.symbol)])];
  const quotes: Record<string, Quote> = {};
  const live: Record<Market, boolean> = { stocks: false, crypto: false };
  if (market.hasKeys) {
    try {
      Object.assign(quotes, await market.quotes("stocks", stockSymbols));
      live.stocks = true;
    } catch (err) {
      errors.push(`stock prices: ${msg(err)}`);
    }
  }
  try {
    Object.assign(quotes, await market.quotes("crypto", CRYPTO_WATCHLIST));
    live.crypto = true;
  } catch (err) {
    errors.push(`crypto prices: ${msg(err)}`);
  }
  const stocksOpen = live.stocks && clock.isOpen;
  const tape: TapeItem[] = [...STOCK_WATCHLIST, ...CRYPTO_WATCHLIST]
    .filter((sym) => quotes[sym])
    .map((sym) => {
      const q = quotes[sym]!;
      return { s: shortSymbol(sym), p: q.last, chg: q.prevClose ? ((q.last - q.prevClose) / q.prevClose) * 100 : null, m: sym.includes("/") ? "crypto" : "stocks" };
    });
  if (tape.length) await setSetting(db, "trading_tape", { at: now.toISOString(), items: tape });
  steps.prices = { stocks: live.stocks, crypto: live.crypto, stocksOpen, nextOpen: clock.nextOpen };

  // the bells: the US open and close, once a New York day each
  const ny = nyParts(now);
  const nyDay = `${ny.year}-${ny.month}-${ny.day}`;
  const wasOpen = asBool(s.trading_stocks_open, false);
  if (stocksOpen && s.trading_bell_day !== nyDay) {
    await setSetting(db, "trading_bell_day", nyDay);
    await tradingEvent(db, { agentSlug: "trading_chief", message: "The opening bell: US stocks are open", data: { kind: "bell", open: true }, at: now });
  }
  if (live.stocks && wasOpen !== stocksOpen) {
    await setSetting(db, "trading_stocks_open", stocksOpen);
    if (!stocksOpen && wasOpen) await tradingEvent(db, { agentSlug: "trading_chief", message: "The closing bell: US stocks are closed until the next session", data: { kind: "bell", open: false }, at: now });
  }
  if (quotes[CRYPTO_BENCHMARK] && !s.trading_btc_start) await setSetting(db, "trading_btc_start", { price: quotes[CRYPTO_BENCHMARK]!.last, at: now.toISOString() });

  // 2. The Executor: stops and targets touched since the last look, minute by minute
  const execMarkets: Market[] = [...(live.stocks ? (["stocks"] as const) : []), ...(live.crypto ? (["crypto"] as const) : [])];
  const exec = await runExecutor(db, market, execMarkets, quotes, now);
  errors.push(...exec.errors);
  for (const c of exec.closed) {
    const desk = DESKS.find((d) => d.slug === c.desk);
    const win = c.pnlUsd > 0;
    const how = c.reason === "target" ? "hit the target" : c.reason === "trail" ? "trailing stop" : c.reason === "breakeven" ? "stopped at the entry" : c.reason === "time" ? "closed on time" : "stop loss";
    await tradingEvent(db, {
      agentSlug: "trading_runner",
      message: `${desk?.name ?? c.desk} sold ${shortSymbol(c.symbol)}: ${how}, ${win ? "won" : "lost"} ${Math.abs(c.pnlUsd).toFixed(2)} USD`,
      data: { kind: win ? "close_win" : "close_loss", desk: c.desk, symbol: c.symbol, reason: c.reason, pnlUsd: Number(c.pnlUsd.toFixed(4)), pnlPct: Number(c.pnlPct.toFixed(2)) },
      at: now,
    });
  }
  steps.executor = { checked: exec.checked, closed: exec.closed.length };

  // 3. Larry and the marks
  if (stocksOpen && !ownerPaused) steps.larry = await larryBuys(db, quotes, now);
  const marks = await markDesks(db, quotes, now);
  for (const slug of marks.benched) {
    const d = await deskBySlug(db, slug);
    await tradingEvent(db, { agentSlug: "trading_risk", message: `Risk benched ${d?.name ?? slug} for the day: ${d?.statusReason ?? "daily loss limit"}`, data: { kind: "bench", desk: slug }, at: now });
  }
  for (const slug of marks.back) await tradingEvent(db, { agentSlug: "trading_risk", message: `${DESKS.find((d) => d.slug === slug)?.name ?? slug} is off the bench: a new day`, data: { kind: "back", desk: slug }, at: now });
  for (const slug of marks.frozen) {
    const d = await deskBySlug(db, slug);
    await tradingEvent(db, { agentSlug: "trading_risk", message: `Risk froze ${d?.name ?? slug}: ${d?.statusReason ?? "drawdown"}`, data: { kind: "freeze", desk: slug }, at: now });
    if (!simulation) {
      await raiseApproval(db, {
        type: "decision",
        summary: `Unfreeze ${d?.name ?? slug} on Wall Street?`,
        content: { tradingUnfreeze: slug, text: `${d?.name ?? slug} fell ${Math.round(RISK.freezeDrawdownPct * 100)} percent under its best (now ${Number(d?.equityUsd ?? 0).toFixed(2)} of 100 USD, paper money). Its open trades keep their stops. Approve to let it trade again from here, reject to keep it frozen.` },
        riskNote: "Paper money only. Nothing real is at stake.",
        floorId: floor.id,
      }, now);
    }
  }
  steps.equity = { ...marks.equity, snapshot: await snapshotEquity(db, now) };

  // 4. The scanner, then the desks
  const ideas: SignalIdea[] = [];
  for (const m of ["stocks", "crypto"] as const) {
    if (!live[m] || (m === "stocks" && !stocksOpen)) continue;
    try {
      ideas.push(...(await scan(db, market, m, now)));
    } catch (err) {
      errors.push(`${m} scan: ${msg(err)}`);
    }
  }
  const fresh = await recordSignals(db, ideas, simulation, now);
  steps.scanner = { ideas: ideas.length, fresh: fresh.length };
  const loud = fresh.filter((x) => x.idea.score >= SCAN.meetingMin).slice(0, 3);
  for (const f of loud) {
    await tradingEvent(db, { agentSlug: "trading_quant", message: `Quant: ${shortSymbol(f.idea.symbol)} ${SIGNAL_WORDS[f.idea.kind]}, score ${f.idea.score}`, data: { kind: "signal", symbol: f.idea.symbol, signal: f.idea.kind, score: f.idea.score }, at: now });
  }

  if (!ownerPaused) {
    steps.quant = stocksOpen ? await quantBot(db, fresh, quotes, now) : { status: "market closed" };
    steps.meetings = await meetings(db, fresh, quotes, { stocks: stocksOpen, crypto: live.crypto }, simulation, now);
  } else steps.desks = { status: "floor paused by the owner: no new trades, open trades keep their stops" };

  // 5. The AI side jobs, each inside the floor's daily money
  try {
    if (market.hasKeys) steps.news = { added: await fetchNews(db, market, now), ...(await houndTags(db, now, simulation)) };
  } catch (err) {
    errors.push(`news: ${msg(err)}`);
  }
  try {
    steps.brief = await morningBrief(db, now, simulation);
  } catch (err) {
    errors.push(`brief: ${msg(err)}`);
  }
  try {
    const lastCoach = asNumber(s.trading_coach_at ? Date.parse(String(s.trading_coach_at)) : 0, 0);
    if (now.getTime() - lastCoach > 45 * 60_000) {
      steps.coach = await coachLessons(db, now, simulation);
      if ((steps.coach as { status: string }).status === "written") await setSetting(db, "trading_coach_at", now.toISOString());
    }
  } catch (err) {
    errors.push(`coach: ${msg(err)}`);
  }

  // 6. Who is busy in the game, the reports, the one time cap ask
  const budget = await aiBudget(db, now);
  await crewStatus(db, { ownerPaused, aiQuiet: !simulation && budget.leftUsd < 0.02, anyMarket: live.crypto || stocksOpen }, now);
  if (!simulation && budget.leftUsd < 0.02 && s.trading_quiet_day !== dubaiParts(now).dayKey) {
    await setSetting(db, "trading_quiet_day", dubaiParts(now).dayKey);
    await tradingEvent(db, { agentSlug: "trading_chief", message: "The AI crew's money for today is used up: the Quant, Risk and the Runner keep going", data: { kind: "quiet" }, at: now });
  }
  steps.reports = await reports(db, { stocksOpen, wasOpen, live: live.stocks, nyDay, quotes, simulation }, now);
  if (!simulation && !s.trading_cap_asked) steps.capAsk = await askCap(db, floor.id, now);
  await setSetting(db, "trading_status", { at: now.toISOString(), stocksOpen, cryptoLive: live.crypto, stocksLive: live.stocks, hasKeys: market.hasKeys, source: market.source, nextOpen: clock.nextOpen, nextClose: clock.nextClose, errors: errors.slice(0, 5), aiLeftUsd: Math.max(0, Number(budget.leftUsd.toFixed(4))), aiSpentUsd: Number(budget.spentTodayUsd.toFixed(4)), aiLimitUsd: budget.limitUsd });
  steps.errors = errors;
  return { status: "ran", at: now.toISOString(), steps };
}

function msg(err: unknown): string {
  if (err instanceof MarketError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

// Reads 5 minute bars and asks the scanner about every symbol of one market.
async function scan(db: Db, market: MarketData, m: Market, now: Date): Promise<SignalIdea[]> {
  const symbols = m === "stocks" ? STOCK_WATCHLIST : CRYPTO_WATCHLIST;
  const start = new Date(now.getTime() - (m === "stocks" ? 5 * 24 : 12) * 3600_000);
  const bars = await market.bars(m, symbols, "5Min", start, now);
  const trend = await dailyTrend(db, market, m, now);
  const out: SignalIdea[] = [];
  const sessionStart = m === "stocks" ? sessionOpenUtc(now) : null;
  for (const sym of symbols) {
    const list = (bars[sym] ?? []).slice(-SCAN.lookbackBars);
    const session = sessionStart ? list.filter((b) => new Date(b.t).getTime() >= sessionStart.getTime()) : undefined;
    const idea = scanSymbol(sym, m, list, { trendUp: trend[sym] ?? null, sessionBars: session });
    if (idea) out.push(idea);
  }
  return out.sort((a, b) => b.score - a.score);
}

function sessionOpenUtc(now: Date): Date {
  const ny = nyParts(now);
  return new Date(Date.UTC(ny.year, ny.month - 1, ny.day, 9, 30) - ny.offsetMin * 60_000);
}

// Daily closes over their 50 day average, read once a Dubai day per market.
async function dailyTrend(db: Db, market: MarketData, m: Market, now: Date): Promise<Record<string, boolean>> {
  const key = `trading_trend_${m}`;
  const dayKey = dubaiParts(now).dayKey;
  const have = await getSetting<{ dayKey: string; trend: Record<string, boolean> } | null>(db, key, null);
  if (have?.dayKey === dayKey) return have.trend;
  const symbols = m === "stocks" ? STOCK_WATCHLIST : CRYPTO_WATCHLIST;
  const bars: Record<string, Bar[]> = await market.bars(m, symbols, "1Day", new Date(now.getTime() - 110 * 24 * 3600_000), now).catch(() => ({}));
  const trend: Record<string, boolean> = {};
  for (const sym of symbols) {
    const closes = (bars[sym] ?? []).map((b) => b.c);
    const avg = sma(closes, 50);
    const last = closes[closes.length - 1];
    if (avg && last) trend[sym] = last > avg;
  }
  await setSetting(db, key, { dayKey, trend });
  return trend;
}

interface FreshSignal {
  id: string;
  idea: SignalIdea;
}

// Keeps new setups, one per symbol per cooldown.
async function recordSignals(db: Db, ideas: SignalIdea[], simulated: boolean, now: Date): Promise<FreshSignal[]> {
  if (!ideas.length) return [];
  const recent = await db
    .select({ symbol: tradingSignals.symbol })
    .from(tradingSignals)
    .where(and(gte(tradingSignals.createdAt, new Date(now.getTime() - SCAN.cooldownMinutes * 60_000)), inArray(tradingSignals.symbol, ideas.map((i) => i.symbol))));
  const cooling = new Set(recent.map((r) => r.symbol));
  const out: FreshSignal[] = [];
  for (const idea of ideas) {
    if (cooling.has(idea.symbol)) continue;
    const [row] = await db
      .insert(tradingSignals)
      .values({ symbol: idea.symbol, market: idea.market, kind: idea.kind, score: idea.score, price: idea.price.toFixed(8), detail: idea.detail as unknown as Record<string, unknown>, status: "new", simulated, createdAt: now })
      .returning({ id: tradingSignals.id });
    if (row) out.push({ id: row.id, idea });
  }
  return out;
}

// The Quant Bot: pure rules, no meeting. It takes the best breakout or momentum turn over its bar.
async function quantBot(db: Db, fresh: FreshSignal[], quotes: Record<string, Quote>, now: Date) {
  const desk = await deskBySlug(db, "quant");
  if (!desk || desk.status !== "live") return { status: desk ? `desk ${desk.status}` : "no desk" };
  const pick = fresh.find((f) => f.idea.market === "stocks" && (f.idea.kind === "breakout" || f.idea.kind === "momentum") && f.idea.score >= SCAN.quantMin);
  if (!pick) return { status: "nothing over the bar" };
  const q = quotes[pick.idea.symbol];
  if (!q) return { status: "no quote" };
  const plan = defaultPlan(q.ask || q.last, pick.idea.detail.atr30, RISK);
  const res = await openPosition(db, desk, { symbol: pick.idea.symbol, market: "stocks", stop: plan.stop, target: plan.target, thesis: `Quant rule: ${SIGNAL_WORDS[pick.idea.kind]}, score ${pick.idea.score}.`, signalId: pick.id }, q, now);
  if (!res.ok) {
    await db.update(tradingSignals).set({ deskSlug: "quant", status: "skipped", decidedAt: now }).where(eq(tradingSignals.id, pick.id));
    return { status: "skipped", reason: res.reason };
  }
  await db.update(tradingSignals).set({ deskSlug: "quant", status: "taken", decidedAt: now }).where(eq(tradingSignals.id, pick.id));
  await tradingEvent(db, { agentSlug: "trading_quant", message: `Quant Bot bought ${Number(res.position.costUsd).toFixed(2)} USD of ${shortSymbol(pick.idea.symbol)} at ${fmtPrice(Number(res.position.entryPrice))}`, data: { kind: "open", desk: "quant", symbol: pick.idea.symbol, sizeUsd: Number(res.position.costUsd) }, at: now });
  return { status: "bought", symbol: pick.idea.symbol };
}

// The AI desks' meetings: the strongest fresh signals of each open market, a few per pulse.
async function meetings(db: Db, fresh: FreshSignal[], quotes: Record<string, Quote>, open: Record<Market, boolean>, simulation: boolean, now: Date) {
  const out: Array<Record<string, unknown>> = [];
  let held = 0;
  const candidates = fresh.filter((f) => f.idea.score >= SCAN.meetingMin && open[f.idea.market]).sort((a, b) => b.idea.score - a.idea.score);
  for (const f of candidates) {
    if (held >= SCAN.maxMeetingsPerPulse) break;
    const slug = f.idea.market === "stocks" ? "ai_stocks" : "ai_crypto";
    const desk = await deskBySlug(db, slug);
    if (!desk || desk.status !== "live") continue;
    const [met] = await db
      .select({ c: sql<string>`count(*)` })
      .from(tradingSignals)
      .where(and(eq(tradingSignals.deskSlug, slug), gte(tradingSignals.decidedAt, dubaiDayStartUtc(now)), sql`${tradingSignals.meeting} is not null`));
    if (Number(met?.c ?? 0) >= SCAN.maxMeetingsPerDayPerDesk) continue;
    const mine = await openPositions(db, desk.id);
    if (mine.some((p) => p.symbol === f.idea.symbol) || mine.length >= RISK.maxOpenPerDesk) continue;
    const q = quotes[f.idea.symbol];
    if (!q) continue;
    const plan = defaultPlan(q.ask || q.last, f.idea.detail.atr30, RISK);
    const cash = await availableCash(db, desk, now);
    if (cash < RISK.minOrderUsd) continue;
    held += 1;
    let result;
    try {
      result = await deskMeeting(db, { desk, signal: f.idea, plan, open: mine, cashAvailable: cash }, now, simulation);
    } catch (err) {
      out.push({ symbol: f.idea.symbol, status: "failed", error: msg(err) });
      continue;
    }
    if (!result) {
      await db.update(tradingSignals).set({ deskSlug: slug, status: "skipped", decidedAt: now }).where(eq(tradingSignals.id, f.id));
      out.push({ symbol: f.idea.symbol, status: "no AI money left today" });
      break;
    }
    const meeting = { bull: result.bull, bear: result.bear, decision: result.decision, confidence: result.confidence, reason: result.reason, stop: result.stop, target: result.target, sizeUsd: result.sizeUsd, costUsd: result.costUsd };
    await tradingEvent(db, {
      agentSlug: "trading_chief",
      message: `Meeting on ${shortSymbol(f.idea.symbol)}: the Chief says ${result.decision === "buy" ? "BUY" : "PASS"}. ${result.reason}`,
      data: { kind: "meeting", desk: slug, symbol: f.idea.symbol, bull: result.bull, bear: result.bear, decision: result.decision, reason: result.reason },
      at: now,
    });
    if (result.decision === "pass") {
      await db.update(tradingSignals).set({ deskSlug: slug, status: "passed", meeting, decidedAt: now }).where(eq(tradingSignals.id, f.id));
      out.push({ symbol: f.idea.symbol, status: "passed" });
      continue;
    }
    const res = await openPosition(db, desk, { symbol: f.idea.symbol, market: f.idea.market, stop: result.stop, target: result.target, sizeUsd: result.sizeUsd, thesis: result.reason || `${SIGNAL_WORDS[f.idea.kind]} with score ${f.idea.score}`, signalId: f.id, meeting }, q, now);
    if (!res.ok) {
      await db.update(tradingSignals).set({ deskSlug: slug, status: "vetoed", meeting, decidedAt: now }).where(eq(tradingSignals.id, f.id));
      await tradingEvent(db, { agentSlug: "trading_risk", message: `Risk VETO on ${shortSymbol(f.idea.symbol)}: ${res.reason}`, data: { kind: "veto", desk: slug, symbol: f.idea.symbol, reason: res.reason }, at: now });
      out.push({ symbol: f.idea.symbol, status: "vetoed", reason: res.reason });
      continue;
    }
    await db.update(tradingSignals).set({ deskSlug: slug, status: "taken", meeting, decidedAt: now }).where(eq(tradingSignals.id, f.id));
    const p = res.position;
    await tradingEvent(db, {
      agentSlug: "trading_runner",
      message: `${desk.name} bought ${Number(p.costUsd).toFixed(2)} USD of ${shortSymbol(p.symbol)} at ${fmtPrice(Number(p.entryPrice))}, stop ${fmtPrice(Number(p.stopPrice))}, target ${fmtPrice(Number(p.targetPrice))}`,
      data: { kind: "open", desk: slug, symbol: p.symbol, sizeUsd: Number(p.costUsd) },
      at: now,
    });
    out.push({ symbol: f.idea.symbol, status: "bought" });
  }
  return { held, results: out };
}

const CODE_CREW = new Set(["trading_quant", "trading_risk", "trading_runner"]);

// The game shows the crew at work while a market trades, the AI crew slumped once its money is used up.
async function crewStatus(db: Db, input: { ownerPaused: boolean; aiQuiet: boolean; anyMarket: boolean }, now: Date) {
  const [floor] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "trading")).limit(1);
  if (!floor) return;
  const crew = await db.select({ id: agents.id, slug: agents.slug, status: agents.status }).from(agents).where(eq(agents.floorId, floor.id));
  for (const a of crew) {
    let status = "working";
    if (a.slug === "trading_larry") status = "idle";
    else if (input.ownerPaused) status = "paused";
    else if (!input.anyMarket) status = "idle";
    else if (input.aiQuiet && !CODE_CREW.has(a.slug)) status = "idle";
    if (status !== a.status) await db.update(agents).set({ status, updatedAt: now }).where(eq(agents.id, a.id));
  }
}

// The close report after the US close and the weekly report card on Sunday morning, on Telegram.
async function reports(db: Db, input: { stocksOpen: boolean; wasOpen: boolean; live: boolean; nyDay: string; quotes: Record<string, Quote>; simulation: boolean }, now: Date) {
  if (input.simulation) return { status: "simulation" };
  const cfg = await getTelegramConfig(db);
  if (!cfg?.chatId) return { status: "telegram not paired" };
  const out: Record<string, string> = {};
  const btc = input.quotes[CRYPTO_BENCHMARK]?.last ?? null;
  const [floor] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "trading")).limit(1);
  const s = await getSettings(db);
  if (input.live && input.wasOpen && !input.stocksOpen && s.trading_report_day !== input.nyDay) {
    await setSetting(db, "trading_report_day", input.nyDay);
    const spend = await getSpendSummary(db, false, now);
    const body = await closeReport(db, { title: `Wall Street close, ${dubaiParts(now).dayKey}`, from: dubaiDayStartUtc(now), to: now, btcPct: await btcHoldPct(db, btc), aiCostUsd: floor ? spend.todayByFloor[floor.id] ?? 0 : 0 });
    await enqueueMessage(db, { kind: "trading_close", body, now });
    out.close = "queued";
  }
  const p = dubaiParts(now);
  const weekKey = dubaiWeekStartUtc(now).toISOString().slice(0, 10);
  if (p.weekday === 0 && p.hour >= 9 && s.trading_week_report !== weekKey) {
    await setSetting(db, "trading_week_report", weekKey);
    const from = new Date(now.getTime() - 7 * 24 * 3600_000);
    const [cost] = floor
      ? await db.select({ s: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` }).from(budgetLedger).where(and(eq(budgetLedger.floorId, floor.id), eq(budgetLedger.simulated, false), gte(budgetLedger.occurredAt, from)))
      : [{ s: "0" }];
    const body = await closeReport(db, { title: "Wall Street weekly report card", from, to: now, btcPct: await btcHoldPct(db, btc), aiCostUsd: Number(cost?.s ?? 0) });
    await enqueueMessage(db, { kind: "trading_week", body: `${body}\nThe test runs 6 to 8 weeks. Real money only if a desk beats Lazy Larry after costs.`, now });
    out.week = "queued";
  }
  return out;
}

// The floor's AI needs about 0.35 USD a day: the Tower asks the owner once to lift the cap to 2.40.
async function askCap(db: Db, floorId: string, now: Date) {
  await setSetting(db, "trading_cap_asked", now.toISOString());
  const s = await getSettings(db);
  const cap = asNumber(s.daily_cap_usd, 1.7);
  if (cap >= 2.4) return { status: "cap already fits" };
  const [pending] = await db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.type, "spend_increase"), eq(approvals.status, "pending"))).limit(1);
  if (pending) return { status: "a spend item already waits" };
  await raiseApproval(db, {
    type: "spend_increase",
    summary: `Raise the daily cap from ${cap.toFixed(2)} to 2.40 USD for Wall Street`,
    content: { proposedCapUsd: 2.4, proposedCeilingUsd: Math.max(asNumber(s.hard_ceiling_usd, 5), 2.4), text: `Wall Street's AI crew (meetings, news, brief, coach) needs about 0.35 USD a day. Without the raise it shares DocLedger's ${cap.toFixed(2)} USD and the sales floors get less. The Quant, Risk and the Runner cost nothing and run either way.` },
    riskNote: "Real API spend of up to 0.40 USD more a day. Trading itself is paper money.",
    floorId,
  }, now);
  return { status: "asked" };
}
