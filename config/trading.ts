// The Wall Street floor (D075): four desks trade paper money on real prices. Nothing here moves real money.
// Every number the Risk Manager enforces lives in this file, so a rule never hides in a prompt.

export type Market = "stocks" | "crypto";
export type DeskStyle = "ai" | "quant" | "hold";

export interface DeskDef {
  slug: string;
  name: string;
  market: Market;
  style: DeskStyle;
  // who sits at the desk in the game
  agentSlug: string;
}

export const DESKS: DeskDef[] = [
  { slug: "ai_stocks", name: "AI Desk", market: "stocks", style: "ai", agentSlug: "trading_chief" },
  { slug: "ai_crypto", name: "Night Desk", market: "crypto", style: "ai", agentSlug: "trading_chief" },
  { slug: "quant", name: "Quant Bot", market: "stocks", style: "quant", agentSlug: "trading_quant" },
  { slug: "index", name: "Lazy Larry", market: "stocks", style: "hold", agentSlug: "trading_larry" },
];

// Every desk starts with the owner's realistic budget (his words, 2026-10-01: 100 dollars).
export const START_USD = 100;

// The benchmark: Larry buys this on the first open market and never sells. Crypto desks are measured
// against simply holding Bitcoin from the day the floor opened.
export const INDEX_SYMBOL = "SPY";
export const CRYPTO_BENCHMARK = "BTC/USD";

// Liquid names only: tight spreads, plenty of news. Small enough for one data call per pulse.
export const STOCK_WATCHLIST = [
  "SPY", "QQQ", "IWM", "XLE", "XLF",
  "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AMD", "AVGO", "NFLX",
  "JPM", "LLY", "COST", "PLTR", "COIN", "UBER", "MU", "CRM", "SHOP",
];
export const CRYPTO_WATCHLIST = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "LINK/USD", "AVAX/USD", "LTC/USD", "BCH/USD"];

export const RISK = {
  // at most this share of the desk's equity in one trade (25 USD of 100)
  maxPositionPct: 0.25,
  // what one trade may lose if its stop is hit, as a share of equity: the size follows from the stop distance
  riskPerTradePct: 0.012,
  maxOpenPerDesk: 4,
  maxNewTradesPerDay: 6,
  // a desk that loses this share of its day start equity sits on the bench until the next Dubai day
  dailyLossPct: 0.03,
  // a desk this far under its best equity is frozen until the owner says otherwise
  freezeDrawdownPct: 0.15,
  minOrderUsd: 1,
  // stop and target distances the Chief may choose, as a share of the entry price
  minStopPct: 0.004,
  maxStopPct: 0.08,
  minRewardRisk: 1,
  maxRewardRisk: 4,
  // defaults from volatility: the stop 2 ATR under the entry, the target 3 ATR over it (30 minute bars)
  stopAtr: 2,
  targetAtr: 3,
  // a trade that hit neither after this long is closed at the market
  maxHoldHoursStocks: 5 * 24,
  maxHoldHoursCrypto: 72,
  // at +1R the stop moves to the entry; from +2R it trails 1R under the best price
  breakevenAtR: 1,
  trailFromR: 2,
};

// Real costs of a small cash account. Stocks: no commission, but buys fill at the ask and sells at the bid.
// Crypto: Alpaca's taker fee for the first volume tier on each side (docs.alpaca.markets crypto fees).
export const COSTS = {
  cryptoTakerFee: 0.0025,
  // when a quote is missing, half the spread is guessed from the last price
  fallbackHalfSpread: { stocks: 0.0002, crypto: 0.0008 },
};

// The scanner's bar size, and how many bars it reads back.
export const SCAN = {
  timeframe: "5Min",
  lookbackBars: 120,
  // signals at or over this score go to the AI desk's meeting; the Quant Bot takes its own kinds at or over quantMin
  meetingMin: 62,
  quantMin: 70,
  // the same symbol does not raise a new signal for this long
  cooldownMinutes: 90,
  maxMeetingsPerPulse: 2,
  maxMeetingsPerDayPerDesk: 8,
};

// What the AI crew may spend a day, in USD, on top of every other floor's work and always inside the cap.
export const TRADING_DAILY_USD = 0.35;

// Rough cost of each AI job, used before a call to check it fits the day's money.
export const AI_COST_USD = { meeting: 0.02, news: 0.02, brief: 0.1, coach: 0.03 };

// The pulse: how often the floor looks at the market. Price bars are replayed minute by minute, so a missed
// pulse still sees the stop or the target that was touched in between.
export const PULSE_GAP_MS = 4 * 60 * 1000;
export const PULSE_LOCK_MS = 4 * 60 * 1000;
