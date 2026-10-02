// What the game and the Trading tab see of Wall Street (D075). Reads only.
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { CRYPTO_BENCHMARK, DESKS, START_USD, sectorOf } from "@/config/trading";
import type { Db } from "@/db/client";
import { agents, budgetLedger, floors, taskEvents, tradingDesks, tradingEquity, tradingPositions, tradingSignals } from "@/db/schema";
import { getSetting, getSettings } from "@/lib/settings";
import type { DeskPlan, MorningBrief } from "./crew";
import { kindRecords, recentScore, voiceRecords, type KindRecords } from "./learn";
import { shortSymbol } from "./engine";
import type { BenchPoint, StoredReport, TapeItem } from "./pulse";
import { dubaiParts } from "@/lib/time";
import { boardRows, type BoardRow } from "./report";

export interface TradingStatus {
  at: string;
  stocksOpen: boolean;
  cryptoLive: boolean;
  stocksLive: boolean;
  hasKeys: boolean;
  source: string;
  nextOpen: string | null;
  nextClose: string | null;
  breaker?: boolean;
  spyChg?: number | null;
  errors: string[];
  aiLeftUsd: number;
  aiSpentUsd: number;
  aiLimitUsd: number;
}

export interface TradingEvent {
  id: number;
  kind: string;
  message: string;
  agentSlug: string | null;
  data: Record<string, unknown>;
  at: string;
}

export interface VoiceScore {
  who: string;
  right: number;
  of: number;
  allRight: number;
  allOf: number;
}

export interface TradingStateView {
  desks: Array<BoardRow & { open: number }>;
  tape: TapeItem[];
  status: TradingStatus | null;
  btcPct: number | null;
  brief: { mood: string; headline: string } | null;
  events: TradingEvent[];
  // who the firm has learned to trust (D076), best first
  voices: VoiceScore[];
}

export async function voiceScores(db: Db): Promise<VoiceScore[]> {
  const records = await voiceRecords(db);
  return Object.entries(records)
    .map(([who, r]) => ({ who, ...recentScore(r), allRight: r.right, allOf: r.right + r.wrong }))
    .filter((v) => v.of > 0)
    .sort((a, b) => b.right / b.of - a.right / a.of);
}

async function tradingFloorId(db: Db): Promise<string | null> {
  const [f] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "trading")).limit(1);
  return f?.id ?? null;
}

export async function tradingEvents(db: Db, limit = 25): Promise<TradingEvent[]> {
  const fid = await tradingFloorId(db);
  if (!fid) return [];
  const rows = await db
    .select({ id: taskEvents.id, message: taskEvents.message, data: taskEvents.data, createdAt: taskEvents.createdAt, slug: agents.slug })
    .from(taskEvents)
    .leftJoin(agents, eq(agents.id, taskEvents.agentId))
    .where(and(eq(taskEvents.floorId, fid), eq(taskEvents.type, "trading")))
    .orderBy(desc(taskEvents.id))
    .limit(limit);
  return rows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    return { id: r.id, kind: String(data.kind ?? "log"), message: r.message, agentSlug: r.slug ?? null, data, at: r.createdAt.toISOString() };
  });
}

export async function tradingState(db: Db): Promise<TradingStateView | null> {
  const desks = await db.select().from(tradingDesks);
  if (!desks.length) return null;
  const s = await getSettings(db);
  const open = await db.select({ deskId: tradingPositions.deskId }).from(tradingPositions).where(eq(tradingPositions.status, "open"));
  const tape = ((s.trading_tape as { items?: TapeItem[] } | undefined)?.items ?? []) as TapeItem[];
  const btc = tape.find((t) => t.s === shortSymbol(CRYPTO_BENCHMARK));
  const start = s.trading_btc_start as { price?: number } | undefined;
  const brief = s.trading_brief as MorningBrief | undefined;
  const byId = new Map(desks.map((d) => [d.slug, d.id]));
  return {
    desks: boardRows(desks).map((r) => ({ ...r, open: open.filter((o) => o.deskId === byId.get(r.slug)).length })),
    tape,
    status: (s.trading_status as TradingStatus | undefined) ?? null,
    btcPct: btc && start?.price ? ((btc.p - start.price) / start.price) * 100 : null,
    brief: brief ? { mood: brief.mood, headline: brief.headline } : null,
    events: await tradingEvents(db, 25),
    voices: await voiceScores(db),
  };
}

// One trade's review in the terminal (D078).
export interface ReviewView {
  at: string;
  action: string;
  reason: string;
  decidedBy: string;
}

export interface PositionView {
  id: string;
  desk: string;
  symbol: string;
  market: string;
  sizeUsd: number;
  entry: number;
  stop: number | null;
  target: number | null;
  initialStop: number | null;
  last: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  rMultiple: number | null;
  openedAt: string;
  thesis: string | null;
  meeting: unknown;
  reviews: ReviewView[];
}

export interface TradeView {
  id: string;
  desk: string;
  symbol: string;
  market: string;
  sizeUsd: number;
  entry: number;
  exit: number;
  reason: string | null;
  pnlUsd: number;
  pnlPct: number;
  rMultiple: number | null;
  holdHours: number;
  openedAt: string;
  closedAt: string;
  thesis: string | null;
  meeting: unknown;
  lesson: string | null;
  reviews: ReviewView[];
}

// A room call with what came of it (D078): the trade it opened and how that went, or nothing.
export interface CallView {
  id: string;
  symbol: string;
  market: string;
  desk: string | null;
  status: string;
  score: number;
  kind: string;
  meeting: unknown;
  at: string;
  outcome: { state: "open" | "won" | "lost" | "even" | "none"; pnlUsd: number | null };
}

export interface TradeStat {
  trades: number;
  wins: number;
  pnlUsd: number;
  avgR: number | null;
  profitFactor: number | null;
}

export interface TradingAnalytics {
  overall: TradeStat & { expectancyUsd: number | null; avgHoldHours: number | null; best: { symbol: string; pnlUsd: number } | null; worst: { symbol: string; pnlUsd: number } | null };
  byDesk: Record<string, TradeStat>;
  byKind: Record<string, TradeStat>;
  bySector: Record<string, TradeStat>;
  // Dubai hour of the entry, only hours that saw a trade
  byHour: Array<{ hour: number; trades: number; pnlUsd: number }>;
  // the deepest fall from a peak per desk, in percent of the peak, over the stored curve
  drawdownPct: Record<string, number>;
  aiVsPnl: { aiUsd: number; pnlUsd: number };
}

export interface TradingDetail extends TradingStateView {
  curves: Array<{ slug: string; name: string; points: Array<{ at: string; v: number }> }>;
  positions: PositionView[];
  plan: DeskPlan | null;
  trades: TradeView[];
  meetings: Array<{ id: string; symbol: string; desk: string | null; status: string; score: number; kind: string; meeting: unknown; at: string }>;
  calls: CallView[];
  lessons: string[];
  briefFull: MorningBrief | null;
  kinds: KindRecords;
  memo: { memo: string; at: string } | null;
  aiCost: { todayUsd: number; totalUsd: number };
  startUsd: number;
  stats: { signalsToday: number; meetingsToday: number; tradesTotal: number; winRate: number | null };
  // D078: the terminal's extras
  bench: BenchPoint[];
  reports: StoredReport[];
  analytics: TradingAnalytics;
  // desk slug, then sector, then USD at risk in open trades
  exposure: Record<string, Record<string, number>>;
  dayPnl: Record<string, { usd: number; pct: number }>;
}

type ClosedRow = {
  desk: string;
  symbol: string;
  kind: string | null;
  pnlUsd: number;
  rMultiple: number | null;
  holdHours: number;
  openedAt: Date;
};

function stat(rows: ClosedRow[]): TradeStat {
  const wins = rows.filter((r) => r.pnlUsd > 0);
  const losses = rows.filter((r) => r.pnlUsd < 0);
  const won = wins.reduce((a, r) => a + r.pnlUsd, 0);
  const lost = Math.abs(losses.reduce((a, r) => a + r.pnlUsd, 0));
  const rs = rows.map((r) => r.rMultiple).filter((r): r is number => r !== null && Number.isFinite(r));
  return {
    trades: rows.length,
    wins: wins.length,
    pnlUsd: round2(rows.reduce((a, r) => a + r.pnlUsd, 0)),
    avgR: rs.length ? round2(rs.reduce((a, r) => a + r, 0) / rs.length) : null,
    profitFactor: lost > 0 ? round2(won / lost) : won > 0 ? null : null,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// Coins are their own sector on the terminal; stocks use the floor's sector map.
export function sectorFor(symbol: string): string {
  const s = sectorOf(symbol);
  return s === "other" && symbol.includes("/") ? "crypto" : s;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

// Pure: the numbers behind the Analytics tab, from the closed trades and the desks' stored curves (D078).
export function computeAnalytics(rows: ClosedRow[], curves: Array<{ slug: string; points: Array<{ v: number }> }>, aiUsd: number): TradingAnalytics {
  const overall = stat(rows);
  const holds = rows.map((r) => r.holdHours).filter((h) => Number.isFinite(h));
  const sorted = [...rows].sort((a, b) => b.pnlUsd - a.pnlUsd);
  const byHourMap = groupBy(rows, (r) => String(dubaiParts(r.openedAt).hour));
  const drawdownPct: Record<string, number> = {};
  for (const c of curves) {
    let peak = -Infinity;
    let worst = 0;
    for (const p of c.points) {
      peak = Math.max(peak, p.v);
      if (peak > 0) worst = Math.max(worst, ((peak - p.v) / peak) * 100);
    }
    drawdownPct[c.slug] = round2(worst);
  }
  const statMap = (g: Record<string, ClosedRow[]>) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, stat(v)]));
  return {
    overall: {
      ...overall,
      expectancyUsd: rows.length ? round2(overall.pnlUsd / rows.length) : null,
      avgHoldHours: holds.length ? round2(holds.reduce((a, h) => a + h, 0) / holds.length) : null,
      best: sorted[0] ? { symbol: sorted[0].symbol, pnlUsd: round2(sorted[0].pnlUsd) } : null,
      worst: sorted.length ? { symbol: sorted[sorted.length - 1]!.symbol, pnlUsd: round2(sorted[sorted.length - 1]!.pnlUsd) } : null,
    },
    byDesk: statMap(groupBy(rows, (r) => r.desk)),
    byKind: statMap(groupBy(rows.filter((r) => r.kind), (r) => r.kind ?? "other")),
    bySector: statMap(groupBy(rows, (r) => sectorFor(r.symbol))),
    byHour: Object.entries(byHourMap)
      .map(([h, v]) => ({ hour: Number(h), trades: v.length, pnlUsd: round2(v.reduce((a, r) => a + r.pnlUsd, 0)) }))
      .sort((a, b) => a.hour - b.hour),
    drawdownPct,
    aiVsPnl: { aiUsd: round2(aiUsd), pnlUsd: overall.pnlUsd },
  };
}

function rOf(p: { qty: unknown; entryPrice: unknown; initialStop: unknown; pnlUsd?: unknown }, pnl: number | null): number | null {
  const qty = Number(p.qty);
  const entry = Number(p.entryPrice);
  const stop = p.initialStop === null || p.initialStop === undefined ? null : Number(p.initialStop);
  if (pnl === null || stop === null || !Number.isFinite(stop) || stop >= entry || !qty) return null;
  const risk = qty * (entry - stop);
  return risk > 0 ? round2(pnl / risk) : null;
}

const reviewsOf = (raw: unknown): ReviewView[] => ((Array.isArray(raw) ? raw : []) as ReviewView[]).slice(-12).map((r) => ({ at: r.at, action: r.action, reason: r.reason, decidedBy: r.decidedBy }));

export async function tradingDetail(db: Db, now = new Date()): Promise<TradingDetail | null> {
  const base = await tradingState(db);
  if (!base) return null;
  const desks = await db.select().from(tradingDesks);
  const deskName = new Map(desks.map((d) => [d.id, d.slug]));
  const since = new Date(now.getTime() - 21 * 24 * 3600_000);
  const eq_ = await db.select().from(tradingEquity).where(gte(tradingEquity.at, since)).orderBy(asc(tradingEquity.at));
  const curves = DESKS.map((def) => {
    const d = desks.find((x) => x.slug === def.slug);
    const pts = d ? eq_.filter((e) => e.deskId === d.id).map((e) => ({ at: e.at.toISOString(), v: Number(e.equityUsd) })) : [];
    const step = Math.max(1, Math.ceil(pts.length / 240));
    return { slug: def.slug, name: def.name, points: pts.filter((_, i) => i % step === 0 || i === pts.length - 1) };
  });
  const tapeBy = new Map(base.tape.map((t) => [t.s, t.p]));
  const openRows = await db.select().from(tradingPositions).where(eq(tradingPositions.status, "open")).orderBy(desc(tradingPositions.openedAt));
  const positions: PositionView[] = openRows.map((p) => {
    const last = tapeBy.get(shortSymbol(p.symbol)) ?? null;
    const qty = Number(p.qty);
    const cost = Number(p.costUsd);
    const value = last !== null ? qty * last : null;
    const pnl = value === null ? null : value - cost;
    return {
      id: p.id,
      desk: deskName.get(p.deskId) ?? "",
      symbol: p.symbol,
      market: p.market,
      sizeUsd: cost,
      entry: Number(p.entryPrice),
      stop: p.stopPrice === null ? null : Number(p.stopPrice),
      target: p.targetPrice === null ? null : Number(p.targetPrice),
      initialStop: p.initialStop === null ? null : Number(p.initialStop),
      last,
      pnlUsd: pnl,
      pnlPct: value === null || !cost ? null : ((value - cost) / cost) * 100,
      rMultiple: rOf(p, pnl),
      openedAt: p.openedAt.toISOString(),
      thesis: p.thesis,
      meeting: p.meeting,
      reviews: reviewsOf(p.reviews),
    };
  });
  const closed = await db.select().from(tradingPositions).where(eq(tradingPositions.status, "closed")).orderBy(desc(tradingPositions.closedAt)).limit(400);
  const signalIds = [...new Set([...closed.map((p) => p.signalId), ...openRows.map((p) => p.signalId)].filter((x): x is string => !!x))];
  const kindBySignal = new Map<string, string>();
  if (signalIds.length) {
    const sigRows = await db.select({ id: tradingSignals.id, kind: tradingSignals.kind }).from(tradingSignals).where(inArray(tradingSignals.id, signalIds));
    for (const r of sigRows) kindBySignal.set(r.id, r.kind);
  }
  const trades: TradeView[] = closed.map((p) => {
    const pnl = Number(p.pnlUsd);
    const closedAt = p.closedAt ?? p.openedAt;
    return {
      id: p.id,
      desk: deskName.get(p.deskId) ?? "",
      symbol: p.symbol,
      market: p.market,
      sizeUsd: Number(p.costUsd),
      entry: Number(p.entryPrice),
      exit: Number(p.exitPrice),
      reason: p.exitReason,
      pnlUsd: pnl,
      pnlPct: Number(p.pnlPct),
      rMultiple: rOf(p, pnl),
      holdHours: round2((closedAt.getTime() - p.openedAt.getTime()) / 3600_000),
      openedAt: p.openedAt.toISOString(),
      closedAt: closedAt.toISOString(),
      thesis: p.thesis,
      meeting: p.meeting,
      lesson: p.lesson || null,
      reviews: reviewsOf(p.reviews),
    };
  });
  const meetRows = await db.select().from(tradingSignals).where(isNotNull(tradingSignals.meeting)).orderBy(desc(tradingSignals.decidedAt)).limit(60);
  const bySignal = new Map<string, { status: string; pnlUsd: number }>();
  for (const p of closed) if (p.signalId) bySignal.set(p.signalId, { status: "closed", pnlUsd: Number(p.pnlUsd) });
  for (const p of openRows) if (p.signalId) bySignal.set(p.signalId, { status: "open", pnlUsd: 0 });
  const calls: CallView[] = meetRows.map((m) => {
    const got = bySignal.get(m.id);
    const outcome: CallView["outcome"] = !got ? { state: "none", pnlUsd: null } : got.status === "open" ? { state: "open", pnlUsd: null } : { state: got.pnlUsd > 0.005 ? "won" : got.pnlUsd < -0.005 ? "lost" : "even", pnlUsd: round2(got.pnlUsd) };
    return { id: m.id, symbol: m.symbol, market: m.market, desk: m.deskSlug, status: m.status, score: m.score, kind: m.kind, meeting: m.meeting, at: (m.decidedAt ?? m.createdAt).toISOString(), outcome };
  });
  const dayStart = new Date(now.getTime() - 24 * 3600_000);
  const [sig] = await db.select({ c: sql<string>`count(*)` }).from(tradingSignals).where(gte(tradingSignals.createdAt, dayStart));
  const [met] = await db.select({ c: sql<string>`count(*)` }).from(tradingSignals).where(and(gte(tradingSignals.createdAt, dayStart), isNotNull(tradingSignals.meeting)));
  const [all] = await db.select({ c: sql<string>`count(*)`, w: sql<string>`count(*) filter (where ${tradingPositions.pnlUsd} > 0)` }).from(tradingPositions).where(and(eq(tradingPositions.status, "closed"), isNotNull(tradingPositions.signalId)));
  const fid = await tradingFloorId(db);
  const [cost] = fid ? await db.select({ s: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` }).from(budgetLedger).where(and(eq(budgetLedger.floorId, fid), eq(budgetLedger.simulated, false))) : [{ s: "0" }];
  const total = Number(all?.c ?? 0);
  const totalAi = Number(cost?.s ?? 0);
  const exposure: Record<string, Record<string, number>> = {};
  for (const p of positions) {
    const sector = sectorFor(p.symbol);
    (exposure[p.desk] ??= {})[sector] = round2(((exposure[p.desk] ?? {})[sector] ?? 0) + p.sizeUsd);
  }
  const dayPnl: Record<string, { usd: number; pct: number }> = {};
  for (const d of desks) {
    const start = Number(d.dayStartUsd) || Number(d.startUsd);
    const usd = Number(d.equityUsd) - start;
    dayPnl[d.slug] = { usd: round2(usd), pct: start ? round2((usd / start) * 100) : 0 };
  }
  const benchRaw = await getSetting<{ items?: BenchPoint[] } | null>(db, "trading_bench", null);
  const reportsRaw = await getSetting<unknown>(db, "trading_reports", []);
  const analytics = computeAnalytics(
    closed.map((p) => ({ desk: deskName.get(p.deskId) ?? "", symbol: p.symbol, kind: p.signalId ? (kindBySignal.get(p.signalId) ?? null) : null, pnlUsd: Number(p.pnlUsd), rMultiple: rOf(p, Number(p.pnlUsd)), holdHours: ((p.closedAt ?? p.openedAt).getTime() - p.openedAt.getTime()) / 3600_000, openedAt: p.openedAt })),
    curves,
    totalAi,
  );
  return {
    ...base,
    curves,
    positions,
    trades,
    meetings: calls.slice(0, 20).map((c) => ({ id: c.id, symbol: c.symbol, desk: c.desk, status: c.status, score: c.score, kind: c.kind, meeting: c.meeting, at: c.at })),
    calls,
    lessons: await getSetting<string[]>(db, "trading_lessons", []),
    briefFull: await getSetting<MorningBrief | null>(db, "trading_brief", null),
    plan: await getSetting<DeskPlan | null>(db, "trading_plan", null),
    kinds: await kindRecords(db),
    memo: await getSetting<{ memo: string; at: string } | null>(db, "trading_memo", null),
    aiCost: { todayUsd: base.status?.aiSpentUsd ?? 0, totalUsd: totalAi },
    startUsd: START_USD,
    stats: { signalsToday: Number(sig?.c ?? 0), meetingsToday: Number(met?.c ?? 0), tradesTotal: total, winRate: total ? Math.round((Number(all?.w ?? 0) / total) * 100) : null },
    bench: (benchRaw?.items ?? []).filter((b) => b && typeof b.at === "string"),
    reports: (Array.isArray(reportsRaw) ? (reportsRaw as StoredReport[]) : []).filter((r) => r && typeof r.body === "string").slice().reverse(),
    analytics,
    exposure,
    dayPnl,
  };
}
