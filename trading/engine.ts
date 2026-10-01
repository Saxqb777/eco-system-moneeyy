// The Wall Street engine (D075): desks, fills, the Risk Manager's rules and the Executor. Code only.
// Paper money: every fill is worked out from a real (or simulated) quote, with a small cash account's real
// costs, and nothing ever reaches a broker.
import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { COSTS, DESKS, INDEX_SYMBOL, RISK, START_USD, type DeskDef, type Market } from "@/config/trading";
import type { Db } from "@/db/client";
import { agents, floors, settings, taskEvents, tradingDesks, tradingEquity, tradingNews, tradingPositions, tradingSignals } from "@/db/schema";
import type { Bar, MarketData, Quote } from "@/lib/market";
import { dubaiDayStartUtc, dubaiParts } from "@/lib/time";
import { priceDigits, round } from "./indicators";

export type Desk = typeof tradingDesks.$inferSelect;
export type Position = typeof tradingPositions.$inferSelect;

const n = (v: unknown) => Number(v ?? 0);
const usd = (v: number) => v.toFixed(6);
const px = (v: number) => v.toFixed(8);

export function deskDef(slug: string): DeskDef | undefined {
  return DESKS.find((d) => d.slug === slug);
}

export function fmtPrice(p: number): string {
  return p.toFixed(priceDigits(p));
}

export function shortSymbol(symbol: string): string {
  return symbol.replace("/USD", "");
}

// One line on the floor's event feed. The game reads data.kind to know which animation to play.
export async function tradingEvent(db: Db, input: { agentSlug?: string; message: string; data: Record<string, unknown>; at: Date }) {
  const [floor] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "trading")).limit(1);
  let agentId: string | null = null;
  if (input.agentSlug) {
    const [a] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, input.agentSlug)).limit(1);
    agentId = a?.id ?? null;
  }
  await db.insert(taskEvents).values({ floorId: floor?.id ?? null, agentId, type: "trading", message: input.message, data: input.data, createdAt: input.at });
}

// Settings that belong to one race: caches, bells, the brief, the lessons and the report marks.
export const RACE_SETTINGS = ["trading_trend_stocks", "trading_trend_crypto", "trading_btc_start", "trading_brief", "trading_lessons", "trading_tape", "trading_bell_day", "trading_stocks_open", "trading_report_day", "trading_week_report", "trading_quiet_day", "trading_coach_at", "trading_status"];

// The four desks with their 100 USD each. A switch between simulation and real prices starts the race over:
// made up prices and real ones never share a scoreboard.
export async function ensureDesks(db: Db, simulated: boolean, now: Date): Promise<Desk[]> {
  let rows = await db.select().from(tradingDesks);
  if (rows.length && rows.some((d) => d.simulated !== simulated)) {
    await db.delete(tradingPositions);
    await db.delete(tradingSignals);
    await db.delete(tradingEquity);
    await db.delete(tradingNews);
    await db.delete(tradingDesks);
    // what the old race learned or cached belongs to the old prices
    await db.delete(settings).where(inArray(settings.key, RACE_SETTINGS));
    rows = [];
  }
  const have = new Set(rows.map((d) => d.slug));
  const dayKey = dubaiParts(now).dayKey;
  for (const d of DESKS) {
    if (have.has(d.slug)) continue;
    await db
      .insert(tradingDesks)
      .values({ slug: d.slug, name: d.name, market: d.market, style: d.style, startUsd: usd(START_USD), cashUsd: usd(START_USD), equityUsd: usd(START_USD), peakUsd: usd(START_USD), dayStartUsd: usd(START_USD), dayKey, startedAt: now, simulated, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
  }
  return db.select().from(tradingDesks);
}

export async function openPositions(db: Db, deskId?: string): Promise<Position[]> {
  const where = deskId ? and(eq(tradingPositions.status, "open"), eq(tradingPositions.deskId, deskId)) : eq(tradingPositions.status, "open");
  return db.select().from(tradingPositions).where(where);
}

// Buys fill at the ask, sells at the bid. Without a two sided quote, half a typical spread is guessed.
export function buyPrice(q: Quote, market: Market): number {
  return q.ask > 0 && q.ask >= q.bid ? q.ask : q.last * (1 + COSTS.fallbackHalfSpread[market]);
}

export function sellPrice(q: Quote, market: Market): number {
  return q.bid > 0 && q.bid <= q.ask ? q.bid : q.last * (1 - COSTS.fallbackHalfSpread[market]);
}

// A stop or target touched inside a bar fills at that level, or at the bar's open when the price jumped past it,
// less half the spread for selling into the bid.
export function exitFill(level: number, barOpen: number, kind: "stop" | "target", market: Market): number {
  const raw = kind === "stop" ? Math.min(level, barOpen) : Math.max(level, barOpen);
  return raw * (1 - COSTS.fallbackHalfSpread[market]);
}

// The next US business day at the open: when a cash account can use the money from today's stock sale (T+1).
export function settleTime(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 13, 30));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// Cash the desk may spend now: stock sale money waits for settlement.
export async function availableCash(db: Db, desk: Desk, now: Date): Promise<number> {
  const [row] = await db
    .select({ s: sql<string>`coalesce(sum(${tradingPositions.proceedsUsd}), 0)` })
    .from(tradingPositions)
    .where(and(eq(tradingPositions.deskId, desk.id), eq(tradingPositions.status, "closed"), gt(tradingPositions.settlesAt, now)));
  return Math.max(0, n(desk.cashUsd) - n(row?.s));
}

export async function tradesToday(db: Db, deskId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ c: sql<string>`count(*)` })
    .from(tradingPositions)
    .where(and(eq(tradingPositions.deskId, deskId), gte(tradingPositions.openedAt, dubaiDayStartUtc(now))));
  return n(row?.c);
}

export interface TradePlan {
  symbol: string;
  market: Market;
  stop: number;
  target: number | null;
  // what the desk asked for; the Risk Manager may give less
  sizeUsd?: number | null;
  thesis: string;
  signalId?: string | null;
  meeting?: unknown;
}

export type RiskVerdict = { ok: true; sizeUsd: number; stop: number; target: number | null } | { ok: false; reason: string };

// The Risk Manager. Every rule is a number in config/trading.ts, checked in code, never in a prompt.
export function riskCheck(input: {
  desk: Pick<Desk, "status" | "equityUsd">;
  style: DeskDef["style"];
  open: Array<Pick<Position, "symbol">>;
  tradesToday: number;
  cashAvailable: number;
  entry: number;
  plan: Pick<TradePlan, "symbol" | "stop" | "target" | "sizeUsd">;
}): RiskVerdict {
  const { desk, entry, plan } = input;
  const equity = n(desk.equityUsd);
  if (desk.status !== "live") return { ok: false, reason: `desk is ${desk.status}` };
  if (input.open.some((p) => p.symbol === plan.symbol)) return { ok: false, reason: `already holds ${shortSymbol(plan.symbol)}` };
  if (input.style !== "hold") {
    if (input.open.length >= RISK.maxOpenPerDesk) return { ok: false, reason: `${RISK.maxOpenPerDesk} trades already open` };
    if (input.tradesToday >= RISK.maxNewTradesPerDay) return { ok: false, reason: `${RISK.maxNewTradesPerDay} trades today already` };
  }
  if (!(entry > 0)) return { ok: false, reason: "no price" };
  let stop = plan.stop;
  let target = plan.target;
  if (input.style !== "hold") {
    const stopPct = (entry - stop) / entry;
    if (!(stopPct > 0)) return { ok: false, reason: "the stop must sit under the entry" };
    if (stopPct < RISK.minStopPct) stop = entry * (1 - RISK.minStopPct);
    if (stopPct > RISK.maxStopPct) stop = entry * (1 - RISK.maxStopPct);
    const risk = entry - stop;
    if (target !== null && target !== undefined) {
      const rr = (target - entry) / risk;
      if (rr < RISK.minRewardRisk) target = entry + risk * RISK.minRewardRisk;
      if (rr > RISK.maxRewardRisk) target = entry + risk * RISK.maxRewardRisk;
    }
  }
  let size: number;
  if (input.style === "hold") size = input.cashAvailable;
  else {
    const riskUsd = equity * RISK.riskPerTradePct;
    const byRisk = (riskUsd / (entry - stop)) * entry;
    size = Math.min(plan.sizeUsd && plan.sizeUsd > 0 ? plan.sizeUsd : byRisk, byRisk, equity * RISK.maxPositionPct, input.cashAvailable);
  }
  size = Math.floor(size * 100) / 100;
  if (size < RISK.minOrderUsd) return { ok: false, reason: input.cashAvailable < RISK.minOrderUsd ? "no settled cash left" : "trade too small" };
  return { ok: true, sizeUsd: size, stop, target: target ?? null };
}

// Opens a long position at the ask. Crypto pays the taker fee out of the coins received.
export async function openPosition(db: Db, desk: Desk, plan: TradePlan, quote: Quote, now: Date): Promise<{ ok: true; position: Position } | { ok: false; reason: string }> {
  const def = deskDef(desk.slug);
  const open = await openPositions(db, desk.id);
  const entry = buyPrice(quote, plan.market);
  const verdict = riskCheck({ desk, style: def?.style ?? "ai", open, tradesToday: await tradesToday(db, desk.id, now), cashAvailable: await availableCash(db, desk, now), entry, plan });
  if (!verdict.ok) return verdict;
  const fee = plan.market === "crypto" ? verdict.sizeUsd * COSTS.cryptoTakerFee : 0;
  const qty = (verdict.sizeUsd - fee) / entry;
  const stop = def?.style === "hold" ? null : verdict.stop;
  const [position] = await db
    .insert(tradingPositions)
    .values({
      deskId: desk.id,
      symbol: plan.symbol,
      market: plan.market,
      status: "open",
      qty: px(qty),
      entryPrice: px(entry),
      stopPrice: stop === null ? null : px(stop),
      initialStop: stop === null ? null : px(stop),
      targetPrice: verdict.target === null || def?.style === "hold" ? null : px(verdict.target),
      highWater: px(entry),
      costUsd: usd(verdict.sizeUsd),
      entryFeeUsd: usd(fee),
      thesis: plan.thesis,
      signalId: plan.signalId ?? null,
      meeting: (plan.meeting ?? null) as Record<string, unknown> | null,
      lastCheckedAt: now,
      openedAt: now,
      simulated: desk.simulated,
      createdAt: now,
    })
    .returning();
  await db
    .update(tradingDesks)
    .set({ cashUsd: usd(n(desk.cashUsd) - verdict.sizeUsd), feesUsd: usd(n(desk.feesUsd) + fee), updatedAt: now })
    .where(eq(tradingDesks.id, desk.id));
  return { ok: true, position: position! };
}

export type ExitReason = "stop" | "breakeven" | "trail" | "target" | "time" | "manual";

// Sells everything at the given price. The proceeds land in cash at once but a stock sale's money only
// counts as spendable after settlement.
export async function closePosition(db: Db, p: Position, price: number, reason: ExitReason, now: Date): Promise<{ pnlUsd: number; pnlPct: number; proceedsUsd: number }> {
  const qty = n(p.qty);
  const gross = qty * price;
  const fee = p.market === "crypto" ? gross * COSTS.cryptoTakerFee : 0;
  const proceeds = gross - fee;
  const cost = n(p.costUsd);
  const pnl = proceeds - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  await db
    .update(tradingPositions)
    .set({
      status: "closed",
      exitPrice: px(price),
      exitFeeUsd: usd(fee),
      exitReason: reason,
      proceedsUsd: usd(proceeds),
      pnlUsd: usd(pnl),
      pnlPct: pnlPct.toFixed(4),
      settlesAt: p.market === "stocks" ? settleTime(now) : null,
      closedAt: now,
      lastCheckedAt: now,
    })
    .where(eq(tradingPositions.id, p.id));
  const [desk] = await db.select().from(tradingDesks).where(eq(tradingDesks.id, p.deskId)).limit(1);
  if (desk) await db.update(tradingDesks).set({ cashUsd: usd(n(desk.cashUsd) + proceeds), feesUsd: usd(n(desk.feesUsd) + fee), updatedAt: now }).where(eq(tradingDesks.id, desk.id));
  return { pnlUsd: pnl, pnlPct, proceedsUsd: proceeds };
}

export interface ReplayOutcome {
  exit: { price: number; reason: ExitReason; at: string } | null;
  stop: number | null;
  highWater: number;
}

// The Executor, minute by minute: walks the bars since the last check, moves the stop up as the trade earns
// (to the entry at +1R, trailing 1R under the best price from +2R) and finds the first stop or target touched.
// A bar that touched both counts as the stop: the careful reading.
export function replayBars(p: Pick<Position, "entryPrice" | "stopPrice" | "initialStop" | "targetPrice" | "highWater" | "market">, bars: Bar[]): ReplayOutcome {
  const entry = n(p.entryPrice);
  let stop = p.stopPrice === null ? null : n(p.stopPrice);
  const target = p.targetPrice === null ? null : n(p.targetPrice);
  const initial = p.initialStop === null ? null : n(p.initialStop);
  const r = initial !== null ? entry - initial : null;
  let high = Math.max(entry, n(p.highWater));
  const market = p.market as Market;
  for (const b of bars) {
    if (stop !== null && b.l <= stop) {
      const reason: ExitReason = stop >= entry * 1.0005 ? "trail" : stop >= entry * 0.9995 ? "breakeven" : "stop";
      return { exit: { price: exitFill(stop, b.o, "stop", market), reason, at: b.t }, stop, highWater: high };
    }
    if (target !== null && b.h >= target) return { exit: { price: exitFill(target, b.o, "target", market), reason: "target", at: b.t }, stop, highWater: Math.max(high, b.h) };
    high = Math.max(high, b.h);
    if (r !== null && r > 0 && stop !== null) {
      if (high >= entry + RISK.breakevenAtR * r) stop = Math.max(stop, entry);
      if (high >= entry + RISK.trailFromR * r) stop = Math.max(stop, high - r);
    }
  }
  return { exit: null, stop, highWater: high };
}

export interface ExecutorResult {
  checked: number;
  closed: Array<{ positionId: string; desk: string; symbol: string; reason: ExitReason; pnlUsd: number; pnlPct: number }>;
  errors: string[];
}

// Runs the Executor over every open position of the markets given. Stocks are only replayed with session bars.
export async function runExecutor(db: Db, market: MarketData, markets: Market[], quotes: Record<string, Quote>, now: Date): Promise<ExecutorResult> {
  const out: ExecutorResult = { checked: 0, closed: [], errors: [] };
  const desks = new Map((await db.select().from(tradingDesks)).map((d) => [d.id, d]));
  const open = (await openPositions(db)).filter((p) => markets.includes(p.market as Market));
  for (const m of markets) {
    const mine = open.filter((p) => p.market === m && p.stopPrice !== null);
    if (!mine.length) continue;
    const since = new Date(Math.min(...mine.map((p) => (p.lastCheckedAt ?? p.openedAt).getTime())));
    let bars: Record<string, Bar[]> = {};
    try {
      bars = await market.bars(m, [...new Set(mine.map((p) => p.symbol))], "1Min", new Date(since.getTime() - 60_000), now);
    } catch (err) {
      out.errors.push(`${m} minute bars: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const p of mine) {
      out.checked += 1;
      const from = (p.lastCheckedAt ?? p.openedAt).getTime();
      const list = (bars[p.symbol] ?? []).filter((b) => new Date(b.t).getTime() >= from - 59_000);
      const res = replayBars(p, list);
      const desk = desks.get(p.deskId);
      if (res.exit) {
        const exitAt = new Date(Math.min(now.getTime(), new Date(res.exit.at).getTime() + 60_000));
        const r = await closePosition(db, p, res.exit.price, res.exit.reason, exitAt);
        out.closed.push({ positionId: p.id, desk: desk?.slug ?? "", symbol: p.symbol, reason: res.exit.reason, pnlUsd: r.pnlUsd, pnlPct: r.pnlPct });
        continue;
      }
      // a trade that went nowhere for too long is closed at the bid
      const maxHours = p.market === "crypto" ? RISK.maxHoldHoursCrypto : RISK.maxHoldHoursStocks;
      const q = quotes[p.symbol];
      if (q && now.getTime() - p.openedAt.getTime() > maxHours * 3600_000) {
        const r = await closePosition(db, p, sellPrice(q, p.market as Market), "time", now);
        out.closed.push({ positionId: p.id, desk: desk?.slug ?? "", symbol: p.symbol, reason: "time", pnlUsd: r.pnlUsd, pnlPct: r.pnlPct });
        continue;
      }
      const lastBar = list[list.length - 1];
      await db
        .update(tradingPositions)
        .set({ stopPrice: res.stop === null ? null : px(res.stop), highWater: px(res.highWater), lastCheckedAt: lastBar ? new Date(new Date(lastBar.t).getTime() + 60_000) : p.lastCheckedAt })
        .where(eq(tradingPositions.id, p.id));
    }
  }
  return out;
}

// Larry's whole job: on the first open market, put every dollar in the index, then nap.
export async function larryBuys(db: Db, quotes: Record<string, Quote>, now: Date): Promise<{ bought: boolean; reason?: string }> {
  const [desk] = await db.select().from(tradingDesks).where(eq(tradingDesks.slug, "index")).limit(1);
  if (!desk) return { bought: false, reason: "no desk" };
  const q = quotes[INDEX_SYMBOL];
  if (!q) return { bought: false, reason: "no index price" };
  if ((await openPositions(db, desk.id)).length) return { bought: false, reason: "already holds the index" };
  if (n(desk.cashUsd) < RISK.minOrderUsd) return { bought: false, reason: "no cash" };
  const res = await openPosition(db, desk, { symbol: INDEX_SYMBOL, market: "stocks", stop: 0, target: null, thesis: "Buy the whole market and hold it. No stops, no news, no meetings." }, q, now);
  if (!res.ok) return { bought: false, reason: res.reason };
  await tradingEvent(db, { agentSlug: "trading_larry", message: `Larry bought ${INDEX_SYMBOL} with all ${n(res.position.costUsd).toFixed(2)} USD and went back to sleep`, data: { kind: "larry_buy", desk: "index", symbol: INDEX_SYMBOL }, at: now });
  return { bought: true };
}

export interface MarkResult {
  equity: Record<string, number>;
  benched: string[];
  frozen: string[];
  back: string[];
}

// Marks every desk to the bid, rolls the Dubai day, and applies the daily loss bench and the drawdown freeze.
export async function markDesks(db: Db, quotes: Record<string, Quote>, now: Date): Promise<MarkResult> {
  const out: MarkResult = { equity: {}, benched: [], frozen: [], back: [] };
  const desks = await db.select().from(tradingDesks);
  const open = await openPositions(db);
  const dayKey = dubaiParts(now).dayKey;
  for (const d of desks) {
    let value = n(d.cashUsd);
    for (const p of open.filter((x) => x.deskId === d.id)) {
      const q = quotes[p.symbol];
      value += n(p.qty) * (q ? sellPrice(q, p.market as Market) * (p.market === "crypto" ? 1 - COSTS.cryptoTakerFee : 1) : n(p.entryPrice));
    }
    const equity = round(value, 6);
    out.equity[d.slug] = equity;
    const patch: Partial<typeof tradingDesks.$inferInsert> = { equityUsd: usd(equity), peakUsd: usd(Math.max(n(d.peakUsd), equity)), updatedAt: now };
    let status = d.status;
    if (d.dayKey !== dayKey) {
      patch.dayKey = dayKey;
      patch.dayStartUsd = usd(equity);
      if (status === "benched") {
        status = "live";
        patch.status = "live";
        patch.statusReason = null;
        patch.benchedUntil = null;
        out.back.push(d.slug);
      }
    }
    const dayStart = d.dayKey === dayKey ? n(d.dayStartUsd) : equity;
    if (status === "live" && d.style !== "hold") {
      if (equity < Math.max(n(d.peakUsd), equity) * (1 - RISK.freezeDrawdownPct)) {
        patch.status = "frozen";
        patch.statusReason = `${Math.round(RISK.freezeDrawdownPct * 100)} percent under its best`;
        out.frozen.push(d.slug);
      } else if (equity < dayStart * (1 - RISK.dailyLossPct)) {
        patch.status = "benched";
        patch.statusReason = `lost ${(dayStart - equity).toFixed(2)} USD today`;
        patch.benchedUntil = new Date(dubaiDayStartUtc(now).getTime() + 24 * 3600_000);
        out.benched.push(d.slug);
      }
    }
    await db.update(tradingDesks).set(patch).where(eq(tradingDesks.id, d.id));
  }
  return out;
}

// One equity point per desk every 15 minutes, for the charts.
export async function snapshotEquity(db: Db, now: Date): Promise<boolean> {
  const [last] = await db.select({ at: tradingEquity.at }).from(tradingEquity).orderBy(desc(tradingEquity.at)).limit(1);
  if (last && now.getTime() - last.at.getTime() < 14 * 60_000) return false;
  const desks = await db.select().from(tradingDesks);
  if (!desks.length) return false;
  await db.insert(tradingEquity).values(desks.map((d) => ({ deskId: d.id, equityUsd: d.equityUsd, at: now, simulated: d.simulated })));
  return true;
}

// The owner unfroze a desk: it trades again from today's equity, the drawdown counted afresh.
export async function unfreezeDesk(db: Db, slug: string, now: Date): Promise<boolean> {
  const [d] = await db.select().from(tradingDesks).where(eq(tradingDesks.slug, slug)).limit(1);
  if (!d) return false;
  await db.update(tradingDesks).set({ status: "live", statusReason: null, benchedUntil: null, peakUsd: d.equityUsd, dayStartUsd: d.equityUsd, updatedAt: now }).where(eq(tradingDesks.id, d.id));
  await tradingEvent(db, { agentSlug: "trading_risk", message: `${d.name} is unfrozen by the owner and trades again`, data: { kind: "unfreeze", desk: slug }, at: now });
  return true;
}

export async function deskBySlug(db: Db, slug: string): Promise<Desk | undefined> {
  const [d] = await db.select().from(tradingDesks).where(eq(tradingDesks.slug, slug)).limit(1);
  return d;
}

export async function desksBySlug(db: Db, slugs: string[]): Promise<Desk[]> {
  return slugs.length ? db.select().from(tradingDesks).where(inArray(tradingDesks.slug, slugs)) : [];
}

