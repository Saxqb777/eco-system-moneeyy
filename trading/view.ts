// What the game and the Trading tab see of Wall Street (D075). Reads only.
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { CRYPTO_BENCHMARK, DESKS, START_USD } from "@/config/trading";
import type { Db } from "@/db/client";
import { agents, budgetLedger, floors, taskEvents, tradingDesks, tradingEquity, tradingPositions, tradingSignals } from "@/db/schema";
import { getSetting, getSettings } from "@/lib/settings";
import type { MorningBrief } from "./crew";
import { shortSymbol } from "./engine";
import type { TapeItem } from "./pulse";
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

export interface TradingStateView {
  desks: Array<BoardRow & { open: number }>;
  tape: TapeItem[];
  status: TradingStatus | null;
  btcPct: number | null;
  brief: { mood: string; headline: string } | null;
  events: TradingEvent[];
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
  };
}

export interface TradingDetail extends TradingStateView {
  curves: Array<{ slug: string; name: string; points: Array<{ at: string; v: number }> }>;
  positions: Array<{ id: string; desk: string; symbol: string; market: string; sizeUsd: number; entry: number; stop: number | null; target: number | null; last: number | null; pnlUsd: number | null; pnlPct: number | null; openedAt: string; thesis: string | null; meeting: unknown }>;
  trades: Array<{ id: string; desk: string; symbol: string; sizeUsd: number; entry: number; exit: number; reason: string | null; pnlUsd: number; pnlPct: number; openedAt: string; closedAt: string; thesis: string | null; meeting: unknown; lesson: string | null }>;
  meetings: Array<{ id: string; symbol: string; desk: string | null; status: string; score: number; kind: string; meeting: unknown; at: string }>;
  lessons: string[];
  briefFull: MorningBrief | null;
  aiCost: { todayUsd: number; totalUsd: number };
  startUsd: number;
  stats: { signalsToday: number; meetingsToday: number; tradesTotal: number; winRate: number | null };
}

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
  const positions = openRows.map((p) => {
    const last = tapeBy.get(shortSymbol(p.symbol)) ?? null;
    const qty = Number(p.qty);
    const cost = Number(p.costUsd);
    const value = last !== null ? qty * last : null;
    return {
      id: p.id,
      desk: deskName.get(p.deskId) ?? "",
      symbol: p.symbol,
      market: p.market,
      sizeUsd: cost,
      entry: Number(p.entryPrice),
      stop: p.stopPrice === null ? null : Number(p.stopPrice),
      target: p.targetPrice === null ? null : Number(p.targetPrice),
      last,
      pnlUsd: value === null ? null : value - cost,
      pnlPct: value === null || !cost ? null : ((value - cost) / cost) * 100,
      openedAt: p.openedAt.toISOString(),
      thesis: p.thesis,
      meeting: p.meeting,
    };
  });
  const closed = await db.select().from(tradingPositions).where(eq(tradingPositions.status, "closed")).orderBy(desc(tradingPositions.closedAt)).limit(40);
  const trades = closed.map((p) => ({
    id: p.id,
    desk: deskName.get(p.deskId) ?? "",
    symbol: p.symbol,
    sizeUsd: Number(p.costUsd),
    entry: Number(p.entryPrice),
    exit: Number(p.exitPrice),
    reason: p.exitReason,
    pnlUsd: Number(p.pnlUsd),
    pnlPct: Number(p.pnlPct),
    openedAt: p.openedAt.toISOString(),
    closedAt: (p.closedAt ?? p.openedAt).toISOString(),
    thesis: p.thesis,
    meeting: p.meeting,
    lesson: p.lesson || null,
  }));
  const meetRows = await db.select().from(tradingSignals).where(isNotNull(tradingSignals.meeting)).orderBy(desc(tradingSignals.decidedAt)).limit(20);
  const dayStart = new Date(now.getTime() - 24 * 3600_000);
  const [sig] = await db.select({ c: sql<string>`count(*)` }).from(tradingSignals).where(gte(tradingSignals.createdAt, dayStart));
  const [met] = await db.select({ c: sql<string>`count(*)` }).from(tradingSignals).where(and(gte(tradingSignals.createdAt, dayStart), isNotNull(tradingSignals.meeting)));
  const [all] = await db.select({ c: sql<string>`count(*)`, w: sql<string>`count(*) filter (where ${tradingPositions.pnlUsd} > 0)` }).from(tradingPositions).where(and(eq(tradingPositions.status, "closed"), isNotNull(tradingPositions.signalId)));
  const fid = await tradingFloorId(db);
  const [cost] = fid ? await db.select({ s: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` }).from(budgetLedger).where(and(eq(budgetLedger.floorId, fid), eq(budgetLedger.simulated, false))) : [{ s: "0" }];
  const total = Number(all?.c ?? 0);
  return {
    ...base,
    curves,
    positions,
    trades,
    meetings: meetRows.map((m) => ({ id: m.id, symbol: m.symbol, desk: m.deskSlug, status: m.status, score: m.score, kind: m.kind, meeting: m.meeting, at: (m.decidedAt ?? m.createdAt).toISOString() })),
    lessons: await getSetting<string[]>(db, "trading_lessons", []),
    briefFull: await getSetting<MorningBrief | null>(db, "trading_brief", null),
    aiCost: { todayUsd: base.status?.aiSpentUsd ?? 0, totalUsd: Number(cost?.s ?? 0) },
    startUsd: START_USD,
    stats: { signalsToday: Number(sig?.c ?? 0), meetingsToday: Number(met?.c ?? 0), tradesTotal: total, winRate: total ? Math.round((Number(all?.w ?? 0) / total) * 100) : null },
  };
}

