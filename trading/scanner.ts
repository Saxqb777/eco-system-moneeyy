// The Quant's scanner: reads 5 minute bars and flags setups worth a meeting. Code only, no model, no cost.
import type { Market } from "@/config/trading";
import type { Bar } from "@/lib/market";
import { aggregate, atr, emaSeries, highest, round, rsiSeries, sma, vwap } from "./indicators";

export type SignalKind = "breakout" | "momentum" | "pullback" | "volume";

export interface SignalIdea {
  symbol: string;
  market: Market;
  kind: SignalKind;
  score: number;
  price: number;
  detail: {
    rsi: number;
    emaFast: number;
    emaSlow: number;
    atr30: number;
    volRatio: number;
    high48: number;
    vwap: number | null;
    trendUp: boolean | null;
    changePct: number;
  };
}

export interface ScanContext {
  // the daily close over its 50 day average, when known
  trendUp?: boolean | null;
  // today's session bars for the VWAP (stocks only)
  sessionBars?: Bar[];
}

export const SIGNAL_WORDS: Record<SignalKind, string> = {
  breakout: "breakout",
  momentum: "momentum turn",
  pullback: "pullback in an uptrend",
  volume: "volume spike",
};

// Volatility on a 30 minute scale: six 5 minute bars folded together; falls back to the 5 minute ATR scaled up.
export function atr30Of(bars: Bar[]): number | null {
  const big = aggregate(bars.slice(bars.length % 6), 6);
  const a = atr(big, 14);
  if (a) return a;
  const small = atr(bars, 14);
  return small ? small * Math.sqrt(6) : null;
}

export function scanSymbol(symbol: string, market: Market, bars: Bar[], ctx: ScanContext = {}): SignalIdea | null {
  if (bars.length < 60) return null;
  const closes = bars.map((b) => b.c);
  const last = bars[bars.length - 1]!;
  const prev = bars[bars.length - 2]!;
  const rsi = rsiSeries(closes, 14);
  const rsiNow = rsi[rsi.length - 1]!;
  const rsiPrev = rsi[rsi.length - 2]!;
  if (!Number.isFinite(rsiNow) || !Number.isFinite(rsiPrev)) return null;
  const fast = emaSeries(closes, 9);
  const slow = emaSeries(closes, 21);
  const a30 = atr30Of(bars);
  if (!a30 || !(a30 > 0)) return null;
  const volAvg = sma(bars.slice(-49, -1).map((b) => b.v), 48) ?? 0;
  const volRatio = volAvg > 0 ? last.v / volAvg : 1;
  const high48 = highest(bars.slice(-49, -1));
  const vw = market === "stocks" && ctx.sessionBars?.length ? vwap(ctx.sessionBars) : null;
  const trendUp = ctx.trendUp ?? null;
  const trendBonus = trendUp === true ? 10 : trendUp === false ? -10 : 0;
  const first = bars[Math.max(0, bars.length - 78)]!;
  const detail = {
    rsi: round(rsiNow, 1),
    emaFast: fast[fast.length - 1]!,
    emaSlow: slow[slow.length - 1]!,
    atr30: a30,
    volRatio: round(volRatio, 2),
    high48,
    vwap: vw,
    trendUp,
    changePct: round(((last.c - first.o) / first.o) * 100, 2),
  };

  const ideas: Array<{ kind: SignalKind; score: number }> = [];

  if (last.c > high48 && volRatio >= 1.5 && rsiNow < 78) {
    ideas.push({ kind: "breakout", score: 55 + Math.min(20, (last.c / high48 - 1) * 2000) + Math.min(15, (volRatio - 1.5) * 6) + trendBonus });
  }

  let crossed = false;
  for (let k = 1; k <= 3; k++) {
    const i = fast.length - k;
    if (i < 1) break;
    if (fast[i]! > slow[i]! && fast[i - 1]! <= slow[i - 1]!) crossed = true;
  }
  // a cross on thin volume is noise: the turn needs buyers and a fresh short high
  const high12 = highest(bars.slice(-13, -1), "c");
  if (crossed && rsiNow >= 52 && rsiNow <= 70 && volRatio >= 1.2 && last.c >= high12 && (vw === null || last.c > vw)) {
    ideas.push({ kind: "momentum", score: 55 + (rsiNow - 50) * 0.6 + Math.min(10, volRatio * 3) + trendBonus });
  }

  const minRsi = Math.min(...rsi.slice(-4, -1).filter(Number.isFinite));
  if (trendUp === true && minRsi < 32 && last.c > prev.c && rsiNow > rsiPrev) {
    ideas.push({ kind: "pullback", score: 60 + Math.min(15, (32 - minRsi) * 1.2) + Math.min(10, volRatio * 2) });
  }

  if (volRatio >= 3 && last.c > last.o && (last.c - last.o) / last.o > 0.002) {
    ideas.push({ kind: "volume", score: 55 + Math.min(25, (volRatio - 3) * 5) + trendBonus });
  }

  const best = ideas.sort((x, y) => y.score - x.score)[0];
  if (!best) return null;
  return { symbol, market, kind: best.kind, score: Math.max(0, Math.min(95, Math.round(best.score))), price: last.c, detail };
}

// The default plan for a long trade from the scanner's numbers: stop 2 ATR under, target 3 ATR over,
// both kept inside the Risk Manager's limits.
export function defaultPlan(price: number, atr30: number, rules: { stopAtr: number; targetAtr: number; minStopPct: number; maxStopPct: number }) {
  const stopDist = Math.min(price * rules.maxStopPct, Math.max(price * rules.minStopPct, atr30 * rules.stopAtr));
  const targetDist = (stopDist / rules.stopAtr) * rules.targetAtr;
  return { stop: price - stopDist, target: price + targetDist };
}
