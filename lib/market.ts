// Market data for the Wall Street floor (D075): Alpaca's free data API when the owner pasted his paper account
// keys, and a made up market in simulation mode (rule 4). Read only: nothing here can place an order.
import type { Db } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";
import type { Market } from "@/config/trading";

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Quote {
  bid: number;
  ask: number;
  last: number;
  prevClose: number | null;
  t: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  url: string | null;
  source: string | null;
  symbols: string[];
  createdAt: string;
}

export interface MarketClock {
  isOpen: boolean;
  nextOpen: string | null;
  nextClose: string | null;
}

export type Timeframe = "1Min" | "5Min" | "30Min" | "1Day";

export interface MarketData {
  source: "alpaca" | "sim";
  // stocks need keys; crypto data may work without them
  hasKeys: boolean;
  bars(market: Market, symbols: string[], timeframe: Timeframe, start: Date, end?: Date): Promise<Record<string, Bar[]>>;
  quotes(market: Market, symbols: string[]): Promise<Record<string, Quote>>;
  news(symbols: string[], since: Date): Promise<NewsItem[]>;
  clock(now?: Date): Promise<MarketClock>;
}

export class MarketError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const ALPACA_KEYS = "alpaca_keys";

// "KEYID SECRET", the two values Alpaca shows when a paper account makes an API key.
export function parseAlpacaKeys(raw: string | null): { keyId: string; secret: string } | null {
  const parts = (raw ?? "").split(/[\s,|]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [keyId, secret] = parts as [string, string];
  if (keyId.length < 10 || secret.length < 20) return null;
  return { keyId, secret };
}

const DATA = "https://data.alpaca.markets";
const PAPER = "https://paper-api.alpaca.markets";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class AlpacaMarket implements MarketData {
  readonly source = "alpaca" as const;
  readonly hasKeys: boolean;

  constructor(private readonly keys: { keyId: string; secret: string } | null, private readonly fetcher: Fetcher = fetch) {
    this.hasKeys = !!keys;
  }

  private async get(url: string): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.keys) {
      headers["APCA-API-KEY-ID"] = this.keys.keyId;
      headers["APCA-API-SECRET-KEY"] = this.keys.secret;
    }
    const res = await this.fetcher(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      throw new MarketError(`Alpaca ${res.status}: ${body}`, res.status);
    }
    return res.json();
  }

  private barsPath(market: Market): string {
    return market === "stocks" ? "/v2/stocks/bars" : "/v1beta3/crypto/us/bars";
  }

  async bars(market: Market, symbols: string[], timeframe: Timeframe, start: Date, end?: Date): Promise<Record<string, Bar[]>> {
    if (!symbols.length) return {};
    if (market === "stocks" && !this.keys) throw new MarketError("Stock prices need the Alpaca keys", 401);
    const out: Record<string, Bar[]> = {};
    let pageToken: string | null = null;
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ symbols: symbols.join(","), timeframe, start: start.toISOString(), limit: "10000", sort: "asc" });
      if (end) q.set("end", end.toISOString());
      if (market === "stocks") {
        q.set("feed", "iex");
        q.set("adjustment", "raw");
      }
      if (pageToken) q.set("page_token", pageToken);
      const json = (await this.get(`${DATA}${this.barsPath(market)}?${q}`)) as { bars?: Record<string, Array<Record<string, number | string>>>; next_page_token?: string | null };
      for (const [sym, rows] of Object.entries(json.bars ?? {})) {
        const list = (out[sym] ??= []);
        for (const r of rows) list.push({ t: String(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v ?? 0) });
      }
      pageToken = json.next_page_token ?? null;
      if (!pageToken) break;
    }
    return out;
  }

  async quotes(market: Market, symbols: string[]): Promise<Record<string, Quote>> {
    if (!symbols.length) return {};
    if (market === "stocks" && !this.keys) throw new MarketError("Stock prices need the Alpaca keys", 401);
    const q = new URLSearchParams({ symbols: symbols.join(",") });
    if (market === "stocks") q.set("feed", "iex");
    const path = market === "stocks" ? "/v2/stocks/snapshots" : "/v1beta3/crypto/us/snapshots";
    const json = (await this.get(`${DATA}${path}?${q}`)) as Record<string, unknown> & { snapshots?: Record<string, unknown> };
    const snaps = (json.snapshots ?? json) as Record<string, Snapshot | null>;
    const out: Record<string, Quote> = {};
    for (const sym of symbols) {
      const s = snaps[sym];
      if (!s) continue;
      const last = Number(s.latestTrade?.p ?? s.minuteBar?.c ?? s.dailyBar?.c ?? 0);
      if (!(last > 0)) continue;
      let bid = Number(s.latestQuote?.bp ?? 0);
      let ask = Number(s.latestQuote?.ap ?? 0);
      // IEX quotes go empty outside the session or on a thin book: fall back to the last trade
      if (!(bid > 0) || !(ask > 0) || ask < bid || (ask - bid) / last > 0.02) {
        bid = last;
        ask = last;
      }
      out[sym] = { bid, ask, last, prevClose: s.prevDailyBar?.c ? Number(s.prevDailyBar.c) : null, t: String(s.latestTrade?.t ?? s.minuteBar?.t ?? new Date().toISOString()) };
    }
    return out;
  }

  async news(symbols: string[], since: Date): Promise<NewsItem[]> {
    if (!this.keys) return [];
    const q = new URLSearchParams({ symbols: symbols.map((s) => s.replace("/", "")).join(","), start: since.toISOString(), limit: "50", sort: "desc", include_content: "false" });
    const json = (await this.get(`${DATA}/v1beta1/news?${q}`)) as { news?: Array<Record<string, unknown>> };
    return (json.news ?? []).map((n) => ({
      id: String(n.id),
      headline: String(n.headline ?? "").trim(),
      summary: String(n.summary ?? "").trim(),
      url: typeof n.url === "string" ? n.url : null,
      source: typeof n.source === "string" ? n.source : null,
      symbols: Array.isArray(n.symbols) ? n.symbols.map(String) : [],
      createdAt: String(n.created_at ?? n.updated_at ?? new Date().toISOString()),
    })).filter((n) => n.headline);
  }

  async clock(now = new Date()): Promise<MarketClock> {
    if (!this.keys) return usSessionClock(now);
    const json = (await this.get(`${PAPER}/v2/clock`)) as { is_open?: boolean; next_open?: string; next_close?: string };
    return { isOpen: !!json.is_open, nextOpen: json.next_open ?? null, nextClose: json.next_close ?? null };
  }
}

interface Snapshot {
  latestTrade?: { p?: number; t?: string };
  latestQuote?: { bp?: number; ap?: number };
  minuteBar?: { c?: number; t?: string };
  dailyBar?: { c?: number };
  prevDailyBar?: { c?: number };
}

// New York's regular session, 09:30 to 16:00 on weekdays, with daylight saving. Holidays are only known to
// Alpaca's clock, so this is the fallback for simulation and for a moment without keys.
export function usSessionClock(now: Date): MarketClock {
  const ny = nyParts(now);
  const openMin = 9 * 60 + 30;
  const closeMin = 16 * 60;
  const mins = ny.hour * 60 + ny.minute;
  const weekday = ny.weekday >= 1 && ny.weekday <= 5;
  const isOpen = weekday && mins >= openMin && mins < closeMin;
  const toUtc = (dayOffset: number, minute: number) => new Date(Date.UTC(ny.year, ny.month - 1, ny.day + dayOffset, 0, minute) - ny.offsetMin * 60_000);
  let nextOpen: Date;
  let d = weekday && mins < openMin ? 0 : 1;
  for (;;) {
    const probe = new Date(Date.UTC(ny.year, ny.month - 1, ny.day + d));
    const wd = probe.getUTCDay();
    if (wd >= 1 && wd <= 5) break;
    d += 1;
  }
  nextOpen = toUtc(d, openMin);
  const nextClose = isOpen ? toUtc(0, closeMin) : toUtc(d, closeMin);
  return { isOpen, nextOpen: nextOpen.toISOString(), nextClose: nextClose.toISOString() };
}

// New York local time: UTC minus 4 hours from the second Sunday of March to the first Sunday of November.
export function nyParts(now: Date) {
  const y = now.getUTCFullYear();
  const nthSunday = (month: number, n: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const dstStart = Date.UTC(y, 2, nthSunday(2, 2), 7); // 02:00 local standard time
  const dstEnd = Date.UTC(y, 10, nthSunday(10, 1), 6); // 02:00 local daylight time
  const offsetMin = now.getTime() >= dstStart && now.getTime() < dstEnd ? -240 : -300;
  const local = new Date(now.getTime() + offsetMin * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes(), weekday: local.getUTCDay(), offsetMin };
}

// The made up market. Prices are a pure function of the symbol and the minute, so the same moment always has
// the same price, bars can be read for any span and nothing has to be stored.
const SIM_BASE: Record<string, number> = {
  SPY: 570, QQQ: 490, IWM: 220, XLE: 90, XLF: 46, AAPL: 230, MSFT: 430, NVDA: 120, AMZN: 190, META: 560, GOOGL: 165,
  TSLA: 250, AMD: 150, AVGO: 170, NFLX: 700, JPM: 210, LLY: 900, COST: 880, PLTR: 40, COIN: 200, UBER: 75, MU: 100, CRM: 280, SHOP: 80,
  "BTC/USD": 64000, "ETH/USD": 2600, "SOL/USD": 150, "DOGE/USD": 0.12, "LINK/USD": 12, "AVAX/USD": 25, "LTC/USD": 70, "BCH/USD": 350,
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(seed: number, n: number): number {
  let x = (seed ^ Math.imul(n | 0, 2654435761)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const PERIODS = [37, 113, 389, 1301, 4211, 14009, 28813];

export function simPrice(symbol: string, at: number): number {
  const seed = hash(symbol);
  const base = SIM_BASE[symbol] ?? 20 + (seed % 400);
  const t = at / 60_000;
  const wild = symbol.includes("/") ? 1.8 : 1;
  let x = 0;
  PERIODS.forEach((p, i) => {
    const phase = (((seed >>> (i * 3)) % 628) / 100);
    x += 0.004 * Math.sqrt(p / 37) * wild * Math.sin((2 * Math.PI * t) / p + phase);
  });
  x += (unit(seed, Math.floor(t)) - 0.5) * 0.002 * wild;
  return base * Math.exp(x);
}

const STEP_MIN: Record<Timeframe, number> = { "1Min": 1, "5Min": 5, "30Min": 30, "1Day": 1440 };

export class SimMarket implements MarketData {
  readonly source = "sim" as const;
  readonly hasKeys = true;

  async bars(market: Market, symbols: string[], timeframe: Timeframe, start: Date, end = new Date()): Promise<Record<string, Bar[]>> {
    const step = STEP_MIN[timeframe] * 60_000;
    const out: Record<string, Bar[]> = {};
    const first = Math.ceil(start.getTime() / step) * step;
    for (const sym of symbols) {
      const seed = hash(sym);
      const list: Bar[] = [];
      for (let t = first; t + step <= end.getTime() && list.length < 3000; t += step) {
        if (market === "stocks" && timeframe !== "1Day" && !usSessionClock(new Date(t)).isOpen) continue;
        if (market === "stocks" && timeframe === "1Day" && [0, 6].includes(new Date(t).getUTCDay())) continue;
        const samples = Math.min(30, STEP_MIN[timeframe]);
        let h = -Infinity;
        let l = Infinity;
        for (let k = 0; k <= samples; k++) {
          const p = simPrice(sym, t + (step * k) / samples);
          h = Math.max(h, p);
          l = Math.min(l, p);
        }
        const n = Math.floor(t / step);
        const spike = unit(seed ^ 77, n) > 0.97 ? 4 : 1;
        list.push({ t: new Date(t).toISOString(), o: simPrice(sym, t), h, l, c: simPrice(sym, t + step), v: Math.round(1000 * STEP_MIN[timeframe] * (0.6 + unit(seed ^ 13, n)) * spike) });
      }
      out[sym] = list;
    }
    return out;
  }

  async quotes(market: Market, symbols: string[], now = new Date()): Promise<Record<string, Quote>> {
    const out: Record<string, Quote> = {};
    const half = market === "crypto" ? 0.0004 : 0.0001;
    const dayAgo = now.getTime() - 24 * 3600_000;
    for (const sym of symbols) {
      const last = simPrice(sym, now.getTime());
      out[sym] = { bid: last * (1 - half), ask: last * (1 + half), last, prevClose: simPrice(sym, dayAgo), t: now.toISOString() };
    }
    return out;
  }

  async news(symbols: string[], since: Date, now = new Date()): Promise<NewsItem[]> {
    const out: NewsItem[] = [];
    const hourStart = Math.floor(since.getTime() / 3600_000);
    const hourEnd = Math.floor(now.getTime() / 3600_000);
    for (let h = Math.max(hourStart, hourEnd - 6); h <= hourEnd; h++) {
      const sym = symbols[h % symbols.length];
      if (!sym) continue;
      const up = unit(hash(sym), h) > 0.5;
      out.push({
        id: `sim-${sym}-${h}`,
        headline: up ? `${sym.replace("/USD", "")} climbs as buyers step in` : `${sym.replace("/USD", "")} slips on profit taking`,
        summary: "Made up headline for the simulation.",
        url: null,
        source: "Simulation",
        symbols: [sym.replace("/", "")],
        createdAt: new Date(h * 3600_000).toISOString(),
      });
    }
    return out;
  }

  async clock(now = new Date()): Promise<MarketClock> {
    return usSessionClock(now);
  }
}

let factory: ((db: Db, simulation: boolean) => Promise<MarketData>) | null = null;

// Tests hand in a fake market here.
export function setMarketFactory(f: ((db: Db, simulation: boolean) => Promise<MarketData>) | null) {
  factory = f;
}

export async function getMarket(db: Db, simulation: boolean): Promise<MarketData> {
  if (factory) return factory(db, simulation);
  if (simulation) return new SimMarket();
  return new AlpacaMarket(parseAlpacaKeys(await clipboardValue(db, ALPACA_KEYS)));
}
