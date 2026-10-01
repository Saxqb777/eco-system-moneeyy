import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setAnthropicFactory } from "@/agents/client";
import { RISK } from "@/config/trading";
import type { Db } from "@/db/client";
import { agents, approvals, budgetLedger, setupItems, taskEvents, tradingDesks, tradingPositions, tradingSignals } from "@/db/schema";
import { applyApprovalDecision } from "@/lib/approvals";
import { encryptSecret } from "@/lib/crypto";
import { SimMarket, nyParts, parseAlpacaKeys, setMarketFactory, simPrice, usSessionClock, type Bar, type MarketData, type Quote } from "@/lib/market";
import { getSetting, setSetting } from "@/lib/settings";
import { getTowerState } from "@/lib/state";
import { setTelegramApi } from "@/lib/telegram";
import { availableCash, closePosition, deskBySlug, ensureDesks, markDesks, openPosition, replayBars, riskCheck, settleTime } from "@/trading/engine";
import { atr, emaSeries, rsiSeries } from "@/trading/indicators";
import { runTradingPulse } from "@/trading/pulse";
import { closeReport, signedPct } from "@/trading/report";
import { defaultPlan, scanSymbol } from "@/trading/scanner";
import { tradingDetail } from "@/trading/view";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let fake: ReturnType<typeof fakeAnthropic>;
// Tuesday 6 October 2026, 11:00 in New York (15:00 UTC, 19:00 Dubai): the US session is open.
const NOW = new Date("2026-10-06T15:00:00Z");

// Flat 5 minute bars around 100, then the last bar jumps on five times the usual volume.
function spikeBars(end: Date, base = 100, spike = true): Bar[] {
  const out: Bar[] = [];
  for (let i = 119; i >= 0; i--) {
    const t = new Date(end.getTime() - (i + 1) * 5 * 60_000);
    const wiggle = Math.sin(i * 1.7) * 0.08;
    const o = base + wiggle;
    const c = base + Math.sin(i * 1.7 + 0.9) * 0.08;
    out.push({ t: t.toISOString(), o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, c, v: 1000 });
  }
  if (spike) {
    const last = out[out.length - 1]!;
    last.o = base;
    last.c = base * 1.006;
    last.h = last.c + 0.02;
    last.v = 5000;
  }
  return out;
}

class FakeMarket implements MarketData {
  readonly source = "alpaca" as const;
  readonly hasKeys = true;
  open = true;
  prices: Record<string, number> = {};
  minute: Record<string, Bar[]> = {};
  hot = "NVDA";
  async bars(_m: "stocks" | "crypto", symbols: string[], tf: string, start: Date, end = new Date()): Promise<Record<string, Bar[]>> {
    const out: Record<string, Bar[]> = {};
    for (const s of symbols) {
      if (tf === "1Day") out[s] = Array.from({ length: 60 }, (_, i) => ({ t: new Date(end.getTime() - (60 - i) * 86400_000).toISOString(), o: 80 + i * 0.3, h: 81 + i * 0.3, l: 79 + i * 0.3, c: 80 + i * 0.3 + 0.2, v: 1e6 }));
      else if (tf === "5Min") out[s] = spikeBars(end, this.prices[s] ?? 100, s === this.hot);
      else out[s] = (this.minute[s] ?? []).filter((b) => new Date(b.t) >= start && new Date(b.t) <= end);
    }
    return out;
  }
  async quotes(_m: "stocks" | "crypto", symbols: string[]): Promise<Record<string, Quote>> {
    const out: Record<string, Quote> = {};
    for (const s of symbols) {
      const p = this.prices[s] ?? (s === this.hot ? 100.6 : 100);
      out[s] = { bid: p * 0.9999, ask: p * 1.0001, last: p, prevClose: p * 0.99, t: NOW.toISOString() };
    }
    return out;
  }
  async news() {
    return [];
  }
  async clock() {
    return { isOpen: this.open, nextOpen: null, nextClose: null };
  }
}

let market: FakeMarket;
let reviewAction = "tighten";

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  fake = fakeAnthropic((params) => {
    const system = JSON.stringify(params.system ?? "");
    if (system.includes("POSITION REVIEW. CHIEF")) return { action: reviewAction, stop: 100.4, reason: "Up nicely: lock in a free trade.", decidedBy: "Risk Officer" };
    if (system.includes("POSITION REVIEW")) return { say: "Still healthy.", vote: "buy", confidence: 3 };
    if (system.includes("MORNING MEETING. You are the CHIEF")) return { mode: "careful", focus: ["NVDA", "FAKE"], avoid: ["AMD"], plan: "Small size, only the cleanest setups." };
    if (system.includes("MORNING MEETING")) return {};
    if (system.includes("END OF DAY")) return {};
    if (system.includes("CHIEF (you read every voice")) return { decision: "buy", sizeUsd: 20, stop: 99, target: 103, reason: "The Bull answered the Bear: volume backs it.", decidedBy: "Bull" };
    if (system.includes("RISK OFFICER (you read everything)")) return { say: "Twelve USD fits. Stop at 99.5.", vote: "buy", confidence: 3, maxSizeUsd: 12, stop: 99.5 };
    if (system.includes("QUANT, chart analyst")) return { say: "Clean spike on five times volume.", vote: "buy", confidence: 4, stop: 99.2 };
    if (system.includes("BEAR (you read")) return { say: "One bar is not a trend. It can fade.", vote: "pass", confidence: 3 };
    if (system.includes("HOUND, news") || system.includes("STRATEGIST, market") || system.includes("BULL (you read")) return { say: "Volume is five times normal and the trend is up.", vote: "buy", confidence: 3 };
    if (system.includes("morning brief")) return { mood: "bullish", headline: "Chips lead", watch: ["NVDA", "FAKE"], avoid: [], notes: "Calm futures." };
    if (system.includes("Coach")) return { lessons: [{ n: 1, lesson: "The stop did its job." }], rule: "Wait for the second bar." };
    if (system.includes("News Hound")) return { items: [] };
    return {};
  });
  setAnthropicFactory(() => fake);
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setMarketFactory(null);
  if (close) await close();
});

beforeEach(() => {
  market = new FakeMarket();
  setMarketFactory(async () => market);
});

describe("Chart math", () => {
  it("computes RSI, EMA and ATR the usual way", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsiSeries(up, 14).at(-1)).toBe(100);
    const ema = emaSeries([10, 10, 10, 20], 3);
    expect(ema.at(-1)).toBe(15);
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: String(i), o: 10, h: 11, l: 9, c: 10, v: 1 }));
    expect(atr(bars, 14)).toBe(2);
  });

  it("flags a volume spike in an uptrend and stays quiet on flat bars", () => {
    const end = new Date("2026-10-06T15:00:00Z");
    const hot = scanSymbol("NVDA", "stocks", spikeBars(end), { trendUp: true });
    expect(hot).not.toBeNull();
    expect(hot!.score).toBeGreaterThanOrEqual(62);
    expect(scanSymbol("AAPL", "stocks", spikeBars(end, 100, false), { trendUp: true })).toBeNull();
    expect(scanSymbol("AAPL", "stocks", spikeBars(end).slice(-40))).toBeNull();
  });

  it("builds a default plan inside the stop limits", () => {
    const plan = defaultPlan(100, 0.01, RISK);
    expect(plan.stop).toBeCloseTo(100 * (1 - RISK.minStopPct), 6);
    const wide = defaultPlan(100, 50, RISK);
    expect(wide.stop).toBeCloseTo(100 * (1 - RISK.maxStopPct), 6);
    expect(wide.target).toBeGreaterThan(100);
  });
});

describe("The Risk Manager", () => {
  const desk = { status: "live", equityUsd: "100" };
  it("sizes a trade by its stop and caps it at a quarter of the desk", () => {
    const tight = riskCheck({ desk, style: "ai", open: [], tradesToday: 0, cashAvailable: 100, entry: 100, plan: { symbol: "NVDA", stop: 99, target: 103, sizeUsd: null } });
    expect(tight).toEqual({ ok: true, sizeUsd: 25, stop: 99, target: 103 });
    const wide = riskCheck({ desk, style: "ai", open: [], tradesToday: 0, cashAvailable: 100, entry: 100, plan: { symbol: "NVDA", stop: 94, target: 110, sizeUsd: null } });
    expect(wide.ok && wide.sizeUsd).toBe(20);
  });

  it("refuses duplicates, a full desk, a busy day, no cash and a benched desk", () => {
    const plan = { symbol: "NVDA", stop: 99, target: 103, sizeUsd: 10 };
    expect(riskCheck({ desk, style: "ai", open: [{ symbol: "NVDA" }], tradesToday: 0, cashAvailable: 100, entry: 100, plan })).toMatchObject({ ok: false });
    expect(riskCheck({ desk, style: "ai", open: [{ symbol: "A" }, { symbol: "B" }, { symbol: "C" }, { symbol: "D" }], tradesToday: 0, cashAvailable: 100, entry: 100, plan })).toMatchObject({ ok: false, reason: "4 trades already open" });
    expect(riskCheck({ desk, style: "ai", open: [], tradesToday: 6, cashAvailable: 100, entry: 100, plan })).toMatchObject({ ok: false });
    expect(riskCheck({ desk, style: "ai", open: [], tradesToday: 0, cashAvailable: 0.5, entry: 100, plan })).toMatchObject({ ok: false, reason: "no settled cash left" });
    expect(riskCheck({ desk: { status: "benched", equityUsd: "100" }, style: "ai", open: [], tradesToday: 0, cashAvailable: 100, entry: 100, plan })).toMatchObject({ ok: false, reason: "desk is benched" });
  });

  it("pulls a stop that is too far back inside the limit and keeps the reward inside 1 to 4 times the risk", () => {
    const res = riskCheck({ desk, style: "ai", open: [], tradesToday: 0, cashAvailable: 100, entry: 100, plan: { symbol: "X", stop: 50, target: 500, sizeUsd: 10 } });
    expect(res.ok && res.stop).toBeCloseTo(92, 6);
    expect(res.ok && res.target).toBeCloseTo(132, 6);
  });
});

describe("The Executor", () => {
  const pos = { entryPrice: "100", stopPrice: "98", initialStop: "98", targetPrice: "104", highWater: "100", market: "stocks" };
  const bar = (h: number, l: number, o = (h + l) / 2): Bar => ({ t: NOW.toISOString(), o, h, l, c: o, v: 1 });

  it("exits at the stop, or at the open when the price gapped through it", () => {
    expect(replayBars(pos, [bar(100.5, 99.5), bar(99, 97.5)]).exit).toMatchObject({ reason: "stop" });
    expect(replayBars(pos, [bar(97, 95, 96)]).exit!.price).toBeLessThan(96);
  });

  it("takes the target, and calls a bar that touched both a stop", () => {
    expect(replayBars(pos, [bar(104.2, 101)]).exit).toMatchObject({ reason: "target" });
    expect(replayBars(pos, [bar(104.5, 97.5)]).exit).toMatchObject({ reason: "stop" });
  });

  it("moves the stop to the entry at 1R and trails from 2R", () => {
    const be = replayBars({ ...pos, targetPrice: "120" }, [bar(102.1, 101)]);
    expect(be.stop).toBe(100);
    const trail = replayBars({ ...pos, targetPrice: "120" }, [bar(105, 103)]);
    expect(trail.stop).toBe(103);
    expect(replayBars({ ...pos, targetPrice: "120" }, [bar(105, 103.5), bar(103.5, 102.9)]).exit).toMatchObject({ reason: "trail" });
  });
});

describe("Paper money", () => {
  it("charges the crypto fee both ways and holds stock sale money until settlement", async () => {
    await ensureDesks(db, false, NOW);
    const crypto = (await deskBySlug(db, "ai_crypto"))!;
    const q: Quote = { bid: 99.9, ask: 100, last: 100, prevClose: null, t: NOW.toISOString() };
    const res = await openPosition(db, crypto, { symbol: "SOL/USD", market: "crypto", stop: 99, target: 103, sizeUsd: 20, thesis: "test" }, q, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Number(res.position.qty)).toBeCloseTo((20 * 0.9975) / 100, 8);
    const out = await closePosition(db, res.position, 102, "target", NOW);
    expect(out.proceedsUsd).toBeCloseTo(0.1995 * 102 * 0.9975, 6);
    expect(out.pnlUsd).toBeCloseTo(out.proceedsUsd - 20, 6);

    const stocks = (await deskBySlug(db, "ai_stocks"))!;
    const s = await openPosition(db, stocks, { symbol: "AAPL", market: "stocks", stop: 99, target: 103, sizeUsd: 20, thesis: "test" }, q, NOW);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    await closePosition(db, s.position, 101, "target", NOW);
    const after = (await deskBySlug(db, "ai_stocks"))!;
    const cash = await availableCash(db, after, NOW);
    expect(cash).toBeCloseTo(Number(after.cashUsd) - Number(s.position.qty) * 101, 6);
    expect(await availableCash(db, after, new Date(settleTime(NOW).getTime() + 1000))).toBeCloseTo(Number(after.cashUsd), 6);
    expect(settleTime(new Date("2026-10-09T18:00:00Z")).toISOString()).toBe("2026-10-12T13:30:00.000Z");
  });

  it("benches a desk on the daily loss limit and freezes it on a deep drawdown", async () => {
    await ensureDesks(db, false, NOW);
    await db.update(tradingDesks).set({ cashUsd: "96.5", dayStartUsd: "100", peakUsd: "100", dayKey: "2026-10-06", status: "live" }).where(eq(tradingDesks.slug, "quant"));
    await db.update(tradingDesks).set({ cashUsd: "100", dayStartUsd: "120", peakUsd: "120", dayKey: "2026-10-06", status: "live" }).where(eq(tradingDesks.slug, "ai_stocks"));
    await db.delete(tradingPositions);
    const res = await markDesks(db, {}, NOW);
    expect(res.benched).toContain("quant");
    expect(res.frozen).toContain("ai_stocks");
    const back = await markDesks(db, {}, new Date("2026-10-06T20:30:00Z"));
    expect(back.back).toContain("quant");
  });
});

describe("The pulse", () => {
  it("runs the whole floor in simulation with no keys at all (rule 4)", async () => {
    setMarketFactory(null);
    await setSetting(db, "simulation_mode", true);
    await setSetting(db, "trading_pulse_at", null);
    const res = await runTradingPulse(db, NOW);
    expect(res.status).toBe("ran");
    const desks = await db.select().from(tradingDesks);
    expect(desks).toHaveLength(4);
    expect(desks.every((d) => d.simulated)).toBe(true);
    const larry = await db.select().from(tradingPositions).where(eq(tradingPositions.symbol, "SPY"));
    expect(larry).toHaveLength(1);
    expect(fake.calls.length).toBe(0);
    expect((await runTradingPulse(db, new Date(NOW.getTime() + 60_000))).status).toBe("fresh");
    const sim = new SimMarket();
    expect(simPrice("NVDA", NOW.getTime())).toBe(simPrice("NVDA", NOW.getTime()));
    expect(Object.keys(await sim.bars("crypto", ["BTC/USD"], "5Min", new Date(NOW.getTime() - 3600_000), NOW))).toEqual(["BTC/USD"]);
  });

  it("starts the race over on real prices, holds a meeting and buys within the rules", async () => {
    await setSetting(db, "simulation_mode", false);
    await setSetting(db, "trading_pulse_at", null);
    await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret("sk-ant-test"), hint: "set" }).where(eq(setupItems.key, "anthropic_api_key"));
    const calls = fake.calls.length;
    const res = await runTradingPulse(db, NOW);
    expect(res.status).toBe("ran");
    const desks = await db.select().from(tradingDesks);
    expect(desks.every((d) => !d.simulated)).toBe(true);
    // the room: seven voices per meeting, the Chief on the strongest model
    const room = fake.calls.slice(calls).filter((c) => /HOUSE RULES/.test(JSON.stringify(c.system)) && !/POSITION REVIEW/.test(JSON.stringify(c.system)));
    expect(room.length % 7).toBe(0);
    expect(room.length).toBeGreaterThanOrEqual(7);
    const chiefCall = room.find((c) => JSON.stringify(c.system).includes("CHIEF (you read every voice"))!;
    expect(chiefCall.model).toBe("claude-opus-5-5");
    // the three analysts each see only their own piece
    const houndCall = room.find((c) => JSON.stringify(c.system).includes("HOUND, news"))!;
    expect(JSON.stringify(houndCall.messages)).not.toMatch(/RSI/);
    const ai = (await deskBySlug(db, "ai_stocks"))!;
    const [nvda] = await db.select().from(tradingPositions).where(and(eq(tradingPositions.deskId, ai.id), eq(tradingPositions.symbol, "NVDA")));
    expect(nvda).toBeTruthy();
    // the Risk Officer's 12 USD is a ceiling the Chief's 20 cannot pass
    expect(Number(nvda!.costUsd)).toBeLessThanOrEqual(12);
    expect(Number(nvda!.stopPrice)).toBeCloseTo(99.5, 4);
    const meeting = nvda!.meeting as { voices: Array<{ who: string }>; decidedBy: string; votes: { buy: number; pass: number } };
    expect(meeting.voices.map((v) => v.who)).toEqual(["Hound", "Quant", "Strategist", "Bull", "Bear", "Risk Officer", "Chief"]);
    expect(meeting.decidedBy).toBe("Bull");
    expect(meeting.votes).toEqual({ buy: 5, pass: 1 });
    const [sig] = await db.select().from(tradingSignals).where(eq(tradingSignals.symbol, "NVDA")).orderBy(desc(tradingSignals.createdAt)).limit(1);
    expect(sig!.status).toBe("taken");
    const kinds = (await db.select().from(taskEvents).where(eq(taskEvents.type, "trading"))).map((e) => (e.data as { kind: string }).kind);
    expect(kinds).toEqual(expect.arrayContaining(["bell", "signal", "meeting", "open", "larry_buy", "brief", "morning"]));
    const plan = await getSetting<{ mode: string; focus: string[]; avoid: string[] } | null>(db, "trading_plan", null);
    expect(plan).toMatchObject({ mode: "careful", focus: ["NVDA"], avoid: ["AMD"] });
    // the AI money went on the trading floor's own line
    const ledger = await db.select().from(budgetLedger);
    expect(ledger.length).toBeGreaterThan(0);
    // the one time ask to lift the cap
    const asks = await db.select().from(approvals).where(eq(approvals.type, "spend_increase"));
    expect(asks).toHaveLength(1);
    const ask = asks[0]!.content as { proposedCapUsd: number; floorShare: Record<string, number> };
    // 1.70 for the rest of the Tower plus 2.00 for Wall Street, the other floors' USD limits unchanged
    expect(ask.proposedCapUsd).toBe(3.7);
    expect(ask.floorShare.docledger! * 3.7).toBeCloseTo(0.55 * 1.7, 2);
    expect(ask.floorShare.trading! * 3.7).toBeCloseTo(2, 2);
    // the crew is at work while a market trades, Larry naps
    const crew = await db.select().from(agents).where(eq(agents.slug, "trading_larry"));
    expect(crew[0]!.status).toBe("idle");
  });

  it("sells at the target minute by minute and the Coach writes a lesson", async () => {
    const ai = (await deskBySlug(db, "ai_stocks"))!;
    const [p] = await db.select().from(tradingPositions).where(and(eq(tradingPositions.deskId, ai.id), eq(tradingPositions.status, "open")));
    const later = new Date(NOW.getTime() + 10 * 60_000);
    market.minute.NVDA = Array.from({ length: 9 }, (_, i) => {
      const t = new Date(NOW.getTime() + (i + 1) * 60_000).toISOString();
      const h = i === 6 ? Number(p!.targetPrice) + 0.1 : 100.8;
      return { t, o: 100.7, h, l: 100.6, c: 100.7, v: 100 };
    });
    await setSetting(db, "trading_pulse_at", null);
    await setSetting(db, "trading_coach_at", null);
    await runTradingPulse(db, later);
    const [closed] = await db.select().from(tradingPositions).where(eq(tradingPositions.id, p!.id));
    expect(closed!.status).toBe("closed");
    expect(closed!.exitReason).toBe("target");
    expect(Number(closed!.pnlUsd)).toBeGreaterThan(0);
    const taught = await db.select().from(tradingPositions).where(eq(tradingPositions.lesson, "The stop did its job."));
    expect(taught).toHaveLength(1);
    expect(await getSetting<string[]>(db, "trading_lessons", [])).toContain("Wait for the second bar.");
  });

  it("reviews an open trade after two hours and tightens the stop, or closes it", async () => {
    const ai = (await deskBySlug(db, "ai_stocks"))!;
    const reviewAt = new Date(NOW.getTime() + 3 * 3600_000);
    market.prices.MU = 101;
    const q: Quote = { bid: 100, ask: 100, last: 100, prevClose: null, t: NOW.toISOString() };
    const opened = await openPosition(db, ai, { symbol: "MU", market: "stocks", stop: 98.5, target: 106, sizeUsd: 10, thesis: "test", signalId: null }, q, NOW);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await setSetting(db, "trading_pulse_at", null);
    await runTradingPulse(db, reviewAt);
    const [p] = await db.select().from(tradingPositions).where(eq(tradingPositions.id, opened.position.id));
    expect(Number(p!.stopPrice)).toBeCloseTo(100.4, 4);
    expect((p!.reviews as unknown[]).length).toBe(1);
    reviewAction = "close";
    await setSetting(db, "trading_pulse_at", null);
    await runTradingPulse(db, new Date(reviewAt.getTime() + 2.5 * 3600_000));
    const [after] = await db.select().from(tradingPositions).where(eq(tradingPositions.id, opened.position.id));
    expect(after!.status).toBe("closed");
    expect(after!.exitReason).toBe("review");
    reviewAction = "tighten";
  });

  it("goes quiet when the AI money is used up and keeps the code crew going", async () => {
    await setSetting(db, "trading_daily_usd", 0.001);
    await setSetting(db, "trading_pulse_at", null);
    market.hot = "AMD";
    const calls = fake.calls.length;
    await runTradingPulse(db, new Date(NOW.getTime() + 20 * 60_000));
    expect(fake.calls.length).toBe(calls);
    const quiet = await db.select().from(taskEvents).where(eq(taskEvents.message, "The AI crew's money for today is used up: the Quant, Risk and the Runner keep going"));
    expect(quiet.length).toBe(1);
    const [chief] = await db.select().from(agents).where(eq(agents.slug, "trading_chief"));
    const [runner] = await db.select().from(agents).where(eq(agents.slug, "trading_runner"));
    expect(chief!.status).toBe("idle");
    expect(runner!.status).toBe("working");
    await setSetting(db, "trading_daily_usd", 0.35);
  });

  it("asks the owner before a frozen desk trades again", async () => {
    await db.update(tradingDesks).set({ peakUsd: "130", status: "live" }).where(eq(tradingDesks.slug, "ai_crypto"));
    await setSetting(db, "trading_pulse_at", null);
    await runTradingPulse(db, new Date(NOW.getTime() + 30 * 60_000));
    expect((await deskBySlug(db, "ai_crypto"))!.status).toBe("frozen");
    const [ask] = await db.select().from(approvals).where(eq(approvals.summary, "Unfreeze Night Desk on Wall Street?"));
    expect(ask).toBeTruthy();
    await applyApprovalDecision(db, ask!.id, "approved", null, "test", new Date(NOW.getTime() + 31 * 60_000));
    const desk = (await deskBySlug(db, "ai_crypto"))!;
    expect(desk.status).toBe("live");
    expect(Number(desk.peakUsd)).toBeCloseTo(Number(desk.equityUsd), 6);
  });

  it("shows the floor to the game and the Trading tab", async () => {
    const state = await getTowerState(db, NOW);
    expect(state.trading?.desks).toHaveLength(4);
    expect(state.trading?.tape.length).toBeGreaterThan(0);
    expect(state.floors.find((f) => f.slug === "trading")?.agents).toHaveLength(10);
    expect(state.floors.some((f) => f.slug === "content")).toBe(false);
    const detail = await tradingDetail(db, NOW);
    expect(detail?.curves).toHaveLength(4);
    expect(detail?.trades.some((t) => t.symbol === "NVDA")).toBe(true);
  });
});

describe("Words for the owner", () => {
  it("never writes a minus sign or a dash", async () => {
    expect(signedPct(-0.6)).toBe("down 0.60 percent");
    expect(signedPct(1.2)).toBe("up 1.20 percent");
    const text = await closeReport(db, { title: "Wall Street close", from: new Date(NOW.getTime() - 86400_000), to: new Date(NOW.getTime() + 86400_000), btcPct: -1.5, aiCostUsd: 0.21 });
    expect(text).toMatch(/Trades closed/);
    expect(text).not.toMatch(/[—–]| - |-\d/);
  });

  it("reads the Alpaca keys as two values and knows New York's hours", () => {
    expect(parseAlpacaKeys("PKABCDEFGHIJ1234 abcdefghijklmnopqrstuvwxyz0123456789")).toEqual({ keyId: "PKABCDEFGHIJ1234", secret: "abcdefghijklmnopqrstuvwxyz0123456789" });
    expect(parseAlpacaKeys("only-one")).toBeNull();
    expect(nyParts(new Date("2026-10-06T15:00:00Z")).hour).toBe(11);
    expect(nyParts(new Date("2026-12-07T15:00:00Z")).hour).toBe(10);
    expect(usSessionClock(new Date("2026-10-06T15:00:00Z")).isOpen).toBe(true);
    expect(usSessionClock(new Date("2026-10-10T15:00:00Z")).isOpen).toBe(false);
    expect(usSessionClock(new Date("2026-10-10T15:00:00Z")).nextOpen).toBe("2026-10-12T13:30:00.000Z");
  });
});
