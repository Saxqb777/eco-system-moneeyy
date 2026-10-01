// Plain chart math for the Scanner and the Risk Manager. Pure functions, no I/O, easy to test.
import type { Bar } from "@/lib/market";

export function sma(values: number[], n: number): number | null {
  if (values.length < n || n <= 0) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i]!;
  return s / n;
}

// Exponential moving average series, seeded with the first value.
export function emaSeries(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (const v of values) {
    prev = out.length ? v * k + prev * (1 - k) : v;
    out.push(prev);
  }
  return out;
}

// Wilder's RSI over the closes, as a series (NaN until there are enough bars).
export function rsiSeries(closes: number[], n = 14): number[] {
  const out: number[] = new Array(closes.length).fill(Number.NaN);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

// Average true range of the last n bars (simple average of true ranges).
export function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  let s = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i]!;
    const prevClose = bars[i - 1]!.c;
    s += Math.max(b.h - b.l, Math.abs(b.h - prevClose), Math.abs(b.l - prevClose));
  }
  return s / n;
}

// Folds small bars into bigger ones (six 5 minute bars make one 30 minute bar), oldest first.
export function aggregate(bars: Bar[], size: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i + size <= bars.length; i += size) {
    const chunk = bars.slice(i, i + size);
    out.push({
      t: chunk[0]!.t,
      o: chunk[0]!.o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1]!.c,
      v: chunk.reduce((s, b) => s + b.v, 0),
    });
  }
  return out;
}

// Volume weighted average price of the bars given (the session's bars for stocks).
export function vwap(bars: Bar[]): number | null {
  let pv = 0;
  let v = 0;
  for (const b of bars) {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    v += b.v;
  }
  return v > 0 ? pv / v : null;
}

export function highest(bars: Bar[], field: "h" | "c" = "h"): number {
  return bars.reduce((m, b) => Math.max(m, b[field]), -Infinity);
}

export function lowest(bars: Bar[], field: "l" | "c" = "l"): number {
  return bars.reduce((m, b) => Math.min(m, b[field]), Infinity);
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// Prices from a few cents to tens of thousands: enough digits to stay meaningful.
export function priceDigits(p: number): number {
  if (p >= 1000) return 2;
  if (p >= 1) return 3;
  if (p >= 0.01) return 5;
  return 8;
}
