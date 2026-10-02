"use client";

import { useMemo, useState } from "react";
import type { CallView, PositionView, TradeView, TradingDetail } from "@/trading/view";
import { Empty, Key, post, since, usePoll, when } from "./shared";

// Wall Street's terminal (D078): the Chief's screens, one tab per question the owner asks.
// Dark glass, green and amber figures, nothing a paper sheet would show.
export type TerminalTabId = "desk" | "stocks" | "crypto" | "calls" | "trades" | "reports" | "analytics";

const DESK_COLOR: Record<string, string> = { ai_stocks: "#3ddc84", ai_crypto: "#5da9e9", quant: "#b58cf5", index: "#ffc857" };
const DESK_NAME: Record<string, string> = { ai_stocks: "AI Desk", ai_crypto: "Night Desk", quant: "Quant Bot", index: "Lazy Larry" };
const EXIT: Record<string, string> = { target: "target hit", stop: "stop loss", breakeven: "out at the entry", trail: "trailing stop", time: "closed on time", review: "closed on review", manual: "closed" };
const STATUS_WORD: Record<string, string> = { taken: "BUY", passed: "PASS", vetoed: "VETO", skipped: "SKIP" };

// Numbers as words and arrows, never a minus sign (rule 7).
function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (Math.abs(v) < 0.005) return "flat";
  return `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(digits)}%`;
}
function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (Math.abs(v) < 0.005) return "even";
  return `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(2)} USD`;
}
// Short money for the tiles: the unit goes in the line under it.
function usdShort(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (Math.abs(v) < 0.005) return "even";
  return `${v > 0 ? "\u25B2" : "\u25BC"} ${Math.abs(v).toFixed(2)}`;
}
function price(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "n/a";
  return p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toFixed(4);
}
const tone = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down");
const sym = (s: string) => s.replace("/USD", "");
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
const rText = (r: number | null) => (r === null ? "" : `${r > 0 ? "▲" : r < 0 ? "▼" : ""} ${Math.abs(r).toFixed(1)}R`);

function dubaiClock(now = new Date()): string {
  return now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
}

// ─── frame ──────────────────────────────────────────────────────────────────────────────────────────────

export function TerminalTab({ tab }: { tab: TerminalTabId }) {
  const q = usePoll<{ trading: TradingDetail | null }>("/api/trading", 10000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const t = q.data?.trading;
  if (!t) return <Empty>{q.error ?? (q.data ? "The floor opens on its first pulse, within 5 minutes." : "Booting the terminal")}</Empty>;

  async function runNow() {
    if (busy) return;
    setBusy(true);
    const res = await post("/api/trading", { action: "pulse" });
    setBusy(false);
    setNote(res.ok ? (res.status === "busy" ? "A pulse is already running." : "The floor looked at the market again.") : (res.error ?? "Could not run the floor"));
    q.reload();
    setTimeout(() => setNote(""), 4000);
  }

  return (
    <div className="terminal">
      <TerminalHead t={t} busy={busy} note={note} onRun={() => void runNow()} />
      <Ticker t={t} />
      {tab === "desk" ? <DeskScreen t={t} /> : null}
      {tab === "stocks" ? <MarketScreen t={t} market="stocks" /> : null}
      {tab === "crypto" ? <MarketScreen t={t} market="crypto" /> : null}
      {tab === "calls" ? <CallsScreen t={t} /> : null}
      {tab === "trades" ? <TradesScreen t={t} /> : null}
      {tab === "reports" ? <ReportsScreen t={t} /> : null}
      {tab === "analytics" ? <AnalyticsScreen t={t} /> : null}
      <div className="t-foot">Paper money only: no real order is ever placed. A desk that beats Lazy Larry after costs for 6 to 8 weeks earns a small real try, every trade approved by you.</div>
    </div>
  );
}

function TerminalHead({ t, busy, note, onRun }: { t: TradingDetail; busy: boolean; note: string; onRun: () => void }) {
  const s = t.status;
  const light = !s ? "dim" : s.breaker ? "red" : s.stocksOpen ? "green" : s.cryptoLive ? "amber" : "dim";
  const word = !s ? "NO PRICES" : s.breaker ? "BREAKER ON" : s.stocksOpen ? "US STOCKS OPEN" : s.cryptoLive ? "CRYPTO ONLY" : "WAITING FOR KEYS";
  return (
    <div className="t-head">
      <div className="t-brand">
        <span className={`t-light ${light}`} />
        <b>WALL STREET</b>
        <span className="t-dim">{word}</span>
      </div>
      <div className="t-head-right">
        <span className="t-dim">{s?.source === "sim" ? "SIM" : "LIVE"} · {dubaiClock()} DUBAI · last look {s ? since(s.at) : "never"}</span>
        <Key small onClick={onRun} disabled={busy}>
          {busy ? "Looking" : "Run the floor now"}
        </Key>
        {note ? <span className="t-dim">{note}</span> : null}
      </div>
    </div>
  );
}

// The LED tape across the top of every screen: every symbol the floor watches, scrolling.
function Ticker({ t }: { t: TradingDetail }) {
  const items = t.tape.length ? t.tape : [];
  if (!items.length) return null;
  const twice = [...items, ...items];
  return (
    <div className="t-ticker" aria-hidden="true">
      <div className="t-ticker-track">
        {twice.map((x, i) => (
          <span key={`${x.s}-${i}`} className={`t-tick ${tone(x.chg)}`}>
            <b>{x.s}</b> {price(x.p)} <i>{pct(x.chg)}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="t-section">
      <div className="t-h">
        <span>{title}</span>
        {right ? <span className="t-dim">{right}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub, tone: tn }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`t-tile ${tn ?? ""}`}>
      <div className="t-tile-label">{label}</div>
      <div className="t-tile-value">{value}</div>
      {sub ? <div className="t-tile-sub">{sub}</div> : null}
    </div>
  );
}

function Stamp({ text, tone: tn }: { text: string; tone: "up" | "down" | "flat" | "amber" | "dim" }) {
  return <span className={`t-stamp ${tn}`}>{text}</span>;
}

// ─── desk ───────────────────────────────────────────────────────────────────────────────────────────────

function DeskScreen({ t }: { t: TradingDetail }) {
  const s = t.status;
  const firm = t.desks.reduce((a, d) => a + d.equityUsd, 0);
  const firmStart = t.startUsd * t.desks.length;
  const today = Object.values(t.dayPnl).reduce((a, d) => a + d.usd, 0);
  const larry = t.desks.find((d) => d.slug === "index");
  const latest = t.events[0];
  return (
    <>
      <div className="t-tiles">
        <Tile label="Firm" value={firm.toFixed(2)} sub={`USD, of ${firmStart} at the start, ${pct(((firm - firmStart) / firmStart) * 100)}`} tone={tone(firm - firmStart)} />
        <Tile label="Today" value={usdShort(today)} sub="USD, all four desks" tone={tone(today)} />
        <Tile label="Open trades" value={String(t.positions.length)} sub={`${t.stats.signalsToday} signals, ${t.stats.meetingsToday} calls in 24 h`} />
        <Tile label="Win rate" value={t.stats.winRate !== null ? `${t.stats.winRate}%` : "n/a"} sub={t.stats.tradesTotal ? `of ${t.stats.tradesTotal} closed trades` : "no closed trades yet"} tone={t.stats.winRate === null ? "flat" : t.stats.winRate >= 50 ? "up" : "down"} />
        <Tile label="AI today" value={(s?.aiSpentUsd ?? 0).toFixed(2)} sub={`USD of ${(s?.aiLimitUsd ?? 2).toFixed(2)}, ${t.aiCost.totalUsd.toFixed(2)} so far`} tone="amber" />
        <Tile label={s?.stocksOpen ? "Closing bell" : "Opening bell"} value={s ? (s.stocksOpen ? when(s.nextClose) : s.stocksLive ? when(s.nextOpen) : "no keys") : "n/a"} sub={s?.breaker ? `breaker on, SPY ${pct(s.spyChg)}` : `SPY ${pct(s?.spyChg)} today`} tone={s?.breaker ? "down" : "flat"} />
      </div>
      {s?.breaker ? <div className="t-alert">CIRCUIT BREAKER: SPY is down {Math.abs(s.spyChg ?? 0).toFixed(2)}% today. No new stock trades until tomorrow, open trades keep their stops.</div> : null}
      {s?.errors.length ? <div className="t-alert amber">{s.errors[0]}</div> : null}

      <Section title="The race" right="paper money, 100 USD each">
        <table className="t-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Desk</th>
              <th className="r">Equity</th>
              <th className="r">Today</th>
              <th className="r">Total</th>
              <th className="r">Open</th>
            </tr>
          </thead>
          <tbody>
            {t.desks.map((d, i) => {
              const day = t.dayPnl[d.slug];
              return (
                <tr key={d.slug} className={d.status !== "live" ? "off" : ""}>
                  <td>{i + 1}</td>
                  <td>
                    <i className="t-dot" style={{ background: DESK_COLOR[d.slug] }} />
                    {d.name}
                    <span className="t-dim"> {d.market === "crypto" ? "crypto" : "stocks"}{d.status !== "live" ? `, ${d.status}` : ""}</span>
                  </td>
                  <td className="r">{d.equityUsd.toFixed(2)}</td>
                  <td className={`r ${tone(day?.usd)}`}>{day ? pct(day.pct) : "n/a"}</td>
                  <td className={`r ${tone(d.pnlPct)}`}>{pct(d.pnlPct)}</td>
                  <td className="r">{d.open}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="t-dim">
          {t.btcPct !== null ? `Bitcoin held since the start: ${pct(t.btcPct)}, the Night Desk's yardstick. ` : ""}
          {larry ? `Lazy Larry holds SPY and does nothing: the bar every desk has to beat.` : ""}
        </div>
        <Curves curves={t.curves} start={t.startUsd} />
      </Section>

      <Section title="On the floor now" right={latest ? since(latest.at) : ""}>
        {latest ? <div className="t-line">{latest.message}</div> : <div className="t-dim">Quiet. The desks wait for a setup worth the risk.</div>}
        {t.plan ? (
          <div className="t-line">
            <Stamp text={`${t.plan.mode.toUpperCase()} DAY`} tone={t.plan.mode === "bold" ? "up" : t.plan.mode === "careful" ? "amber" : "flat"} /> {t.plan.plan}
          </div>
        ) : null}
        {t.brief ? <div className="t-dim">Morning brief, {t.brief.mood}: {t.brief.headline}</div> : null}
      </Section>
    </>
  );
}

// Every desk's money over time against the start line, on dark glass.
function Curves({ curves, start, bench }: { curves: TradingDetail["curves"]; start: number; bench?: TradingDetail["bench"] }) {
  const all = curves.flatMap((c) => c.points);
  if (all.length < 2) return <div className="t-dim">The chart fills in as the desks trade: one point every pulse.</div>;
  const times = all.map((p) => new Date(p.at).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  // the yardsticks as percent moves scaled onto the money axis
  const benchLines: Array<{ key: string; color: string; pts: Array<{ at: string; v: number }> }> = [];
  if (bench && bench.length > 1) {
    for (const key of ["spy", "btc"] as const) {
      const pts = bench.filter((b) => b[key] !== null && new Date(b.at).getTime() >= t0);
      const first = pts[0]?.[key];
      if (first && pts.length > 1) benchLines.push({ key, color: key === "spy" ? "#ffc857" : "#f08a24", pts: pts.map((b) => ({ at: b.at, v: start * ((b[key] as number) / first) })) });
    }
  }
  const vals = [...all.map((p) => p.v), ...benchLines.flatMap((l) => l.pts.map((p) => p.v)), start];
  const lo = Math.min(...vals) - 0.3;
  const hi = Math.max(...vals) + 0.3;
  const W = 340;
  const H = 130;
  const x = (at: string) => 4 + ((new Date(at).getTime() - t0) / (t1 - t0)) * (W - 8);
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="t-chart" role="img" aria-label="Desk money over time">
        <line x1={0} x2={W} y1={y(start)} y2={y(start)} className="start-line" />
        {benchLines.map((l) => (
          <polyline key={l.key} fill="none" stroke={l.color} strokeWidth={1} strokeDasharray="2 3" opacity={0.9} points={l.pts.map((p) => `${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
        ))}
        {curves.map((c) =>
          c.points.length > 1 ? (
            <polyline key={c.slug} fill="none" stroke={DESK_COLOR[c.slug] ?? "#888"} strokeWidth={c.slug === "index" ? 1.6 : 2} strokeDasharray={c.slug === "index" ? "4 3" : undefined} points={c.points.map((p) => `${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
          ) : null,
        )}
      </svg>
      <div className="t-legend">
        {curves.map((c) => (
          <span key={c.slug}>
            <i style={{ background: DESK_COLOR[c.slug] }} /> {c.name}
          </span>
        ))}
        {benchLines.map((l) => (
          <span key={l.key}>
            <i style={{ background: l.color }} /> {l.key === "spy" ? "S&P 500 held" : "Bitcoin held"}
          </span>
        ))}
      </div>
    </>
  );
}

// ─── stocks and crypto ──────────────────────────────────────────────────────────────────────────────────

function MarketScreen({ t, market }: { t: TradingDetail; market: "stocks" | "crypto" }) {
  const tape = t.tape.filter((x) => x.m === market);
  const positions = t.positions.filter((p) => p.market === market);
  const calls = t.calls.filter((c) => c.market === market).slice(0, 8);
  const desks = t.desks.filter((d) => d.market === market);
  const s = t.status;
  return (
    <>
      <div className="t-tiles">
        {desks.map((d) => (
          <Tile key={d.slug} label={d.name} value={d.equityUsd.toFixed(2)} sub={`USD, ${pct(d.pnlPct)} total, ${t.dayPnl[d.slug] ? pct(t.dayPnl[d.slug]!.pct) : "n/a"} today, ${d.open} open${d.status !== "live" ? `, ${d.status}` : ""}`} tone={tone(d.pnlPct)} />
        ))}
        {market === "crypto" ? <Tile label="Bitcoin held" value={pct(t.btcPct)} sub="since the race started: the yardstick" tone={tone(t.btcPct)} /> : <Tile label="Market" value={s ? (s.stocksOpen ? "OPEN" : "CLOSED") : "n/a"} sub={s ? (s.stocksOpen ? `closes ${when(s.nextClose)}` : s.stocksLive ? `opens ${when(s.nextOpen)}` : "waiting for the Alpaca keys") : ""} tone={s?.stocksOpen ? "up" : "flat"} />}
      </div>

      <Section title={market === "crypto" ? "The coins" : "The board"} right={market === "crypto" ? "24 hours a day" : "change on the day"}>
        {tape.length ? (
          <div className="t-heat">
            {tape.map((x) => (
              <div key={x.s} className={`t-cell ${tone(x.chg)} ${heatLevel(x.chg)}`}>
                <b>{x.s}</b>
                <span>{price(x.p)}</span>
                <i>{pct(x.chg)}</i>
              </div>
            ))}
          </div>
        ) : (
          <div className="t-dim">No prices yet.</div>
        )}
      </Section>

      <Section title={`Open trades (${positions.length})`}>
        {positions.length === 0 ? <div className="t-dim">Nothing open on this market.</div> : null}
        {positions.map((p) => (
          <Position key={p.id} p={p} />
        ))}
      </Section>

      <Section title="Where the money sits">
        {desks.map((d) => {
          const ex = t.exposure[d.slug] ?? {};
          const total = Object.values(ex).reduce((a, v) => a + v, 0);
          return (
            <div key={d.slug} className="t-line">
              <b style={{ color: DESK_COLOR[d.slug] }}>{d.name}</b>{" "}
              {total ? (
                <span>
                  {Object.entries(ex)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sector, v]) => `${sector} ${v.toFixed(2)} USD`)
                    .join(", ")}{" "}
                  <span className="t-dim">({total.toFixed(2)} of {d.equityUsd.toFixed(2)} at work)</span>
                </span>
              ) : (
                <span className="t-dim">all cash</span>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Latest calls on this market">
        {calls.length === 0 ? <div className="t-dim">No room calls on this market yet.</div> : null}
        {calls.map((c) => (
          <CallCard key={c.id} c={c} compact />
        ))}
      </Section>
    </>
  );
}

function heatLevel(chg: number | null): string {
  if (chg === null) return "";
  const a = Math.abs(chg);
  return a >= 3 ? "h3" : a >= 1.5 ? "h2" : a >= 0.5 ? "h1" : "";
}

// The stop to entry to target ladder with where the price sits now.
function Ladder({ p }: { p: PositionView }) {
  if (p.stop === null || p.target === null || p.last === null) return null;
  const lo = Math.min(p.stop, p.entry, p.last);
  const hi = Math.max(p.target, p.entry, p.last);
  const span = hi - lo || 1;
  const at = (v: number) => `${(((v - lo) / span) * 100).toFixed(1)}%`;
  return (
    <div className="t-ladder" aria-hidden="true">
      <i className="stop" style={{ left: at(p.stop) }} title={`stop ${price(p.stop)}`} />
      <i className="entry" style={{ left: at(p.entry) }} title={`entry ${price(p.entry)}`} />
      <i className="target" style={{ left: at(p.target) }} title={`target ${price(p.target)}`} />
      <i className={`now ${tone(p.pnlUsd)}`} style={{ left: at(p.last) }} title={`now ${price(p.last)}`} />
    </div>
  );
}

function Position({ p }: { p: PositionView }) {
  return (
    <div className="t-row" style={{ borderLeftColor: DESK_COLOR[p.desk] }}>
      <div className="t-row-top">
        <b>
          {sym(p.symbol)} <span className="t-dim">{DESK_NAME[p.desk] ?? p.desk}, {p.sizeUsd.toFixed(2)} USD, {since(p.openedAt)}</span>
        </b>
        <span className={`t-num ${tone(p.pnlPct)}`}>
          {pct(p.pnlPct)} {p.rMultiple !== null ? <small>{rText(p.rMultiple)}</small> : null}
        </span>
      </div>
      <Ladder p={p} />
      <div className="t-dim">
        stop {price(p.stop)} · entry {price(p.entry)} · now {price(p.last)} · target {price(p.target)}
      </div>
      {p.thesis ? <div className="t-thesis">{p.thesis}</div> : null}
      {p.reviews.length ? (
        <details className="t-details">
          <summary>{p.reviews.length} review{p.reviews.length === 1 ? "" : "s"}</summary>
          {p.reviews.map((r) => (
            <div key={r.at} className="t-dim">
              {since(r.at)}: {r.action === "tighten" ? "tightened the stop" : r.action === "close" ? "closed it" : "hold"}. {r.reason} ({r.decidedBy})
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}

// ─── calls ──────────────────────────────────────────────────────────────────────────────────────────────

type CallFilter = "all" | "today" | "buy" | "pass";

function CallsScreen({ t }: { t: TradingDetail }) {
  const [filter, setFilter] = useState<CallFilter>("all");
  const [desk, setDesk] = useState<string>("all");
  const dayAgo = Date.now() - 24 * 3600_000;
  const list = useMemo(
    () =>
      t.calls.filter((c) => {
        if (desk !== "all" && c.desk !== desk) return false;
        if (filter === "today") return new Date(c.at).getTime() >= dayAgo;
        if (filter === "buy") return c.status === "taken";
        if (filter === "pass") return c.status !== "taken";
        return true;
      }),
    [t.calls, filter, desk, dayAgo],
  );
  const buys = t.calls.filter((c) => c.status === "taken").length;
  return (
    <>
      <div className="t-tiles">
        <Tile label="Calls kept" value={String(t.calls.length)} sub={`${buys} buys, ${t.calls.length - buys} passes or vetoes`} />
        <Tile label="In 24 h" value={String(t.stats.meetingsToday)} sub={`${t.stats.signalsToday} signals scanned`} />
        <Tile label="Most trusted" value={t.voices[0] ? t.voices[0].who : "n/a"} sub={t.voices[0] ? `right ${t.voices[0].right} of ${t.voices[0].of} lately` : "no record yet"} tone="amber" />
      </div>
      <div className="t-chips">
        {(["all", "today", "buy", "pass"] as CallFilter[]).map((f) => (
          <button key={f} className={`t-chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "today" ? "Last 24 h" : f === "buy" ? "Buys" : "Passes"}
          </button>
        ))}
        <span className="t-chip-gap" />
        {["all", "ai_stocks", "ai_crypto", "quant"].map((d) => (
          <button key={d} className={`t-chip ${desk === d ? "on" : ""}`} onClick={() => setDesk(d)}>
            {d === "all" ? "Every desk" : DESK_NAME[d]}
          </button>
        ))}
      </div>
      <Section title="The room" right={`${list.length} shown`}>
        {list.length === 0 ? <div className="t-dim">No calls match. The Chief calls the room when the Quant flags a setup worth arguing about.</div> : null}
        {list.map((c) => (
          <CallCard key={c.id} c={c} />
        ))}
      </Section>
    </>
  );
}

function outcomeStamp(c: CallView): { text: string; tone: "up" | "down" | "flat" | "amber" | "dim" } {
  if (c.status !== "taken") return { text: STATUS_WORD[c.status] ?? c.status.toUpperCase(), tone: c.status === "vetoed" ? "down" : "dim" };
  if (c.outcome.state === "open") return { text: "OPEN", tone: "amber" };
  if (c.outcome.state === "won") return { text: `WON ${Math.abs(c.outcome.pnlUsd ?? 0).toFixed(2)}`, tone: "up" };
  if (c.outcome.state === "lost") return { text: `LOST ${Math.abs(c.outcome.pnlUsd ?? 0).toFixed(2)}`, tone: "down" };
  if (c.outcome.state === "even") return { text: "EVEN", tone: "flat" };
  return { text: "BUY", tone: "up" };
}

function CallCard({ c, compact }: { c: CallView; compact?: boolean }) {
  const m = (c.meeting ?? {}) as { voices?: Array<{ who: string; say: string; vote: string }>; votes?: { buy: number; pass: number }; decision?: string; reason?: string; decidedBy?: string };
  const voices = (m.voices ?? []).filter((x) => x.who !== "Chief");
  const stamp = outcomeStamp(c);
  return (
    <div className={`t-row call ${c.status}`} style={{ borderLeftColor: c.desk ? DESK_COLOR[c.desk] : undefined }}>
      <div className="t-row-top">
        <b>
          {sym(c.symbol)} <span className="t-dim">{c.kind}, score {c.score}{c.desk ? `, ${DESK_NAME[c.desk] ?? c.desk}` : ""}, {since(c.at)}</span>
        </b>
        <Stamp text={stamp.text} tone={stamp.tone} />
      </div>
      {!compact && voices.length ? (
        <div className="t-voices">
          {voices.map((x) => (
            <div key={x.who} className="t-voice">
              <b className={x.vote === "buy" ? "up" : "down"}>
                {x.vote === "buy" ? "▲" : "▼"} {x.who}
              </b>
              <span>{x.say}</span>
            </div>
          ))}
        </div>
      ) : null}
      {m.decision ? (
        <div className="t-chief">
          <b>CHIEF</b> {m.decision === "buy" ? "BUY" : "PASS"}
          {m.reason ? `: ${m.reason}` : ""}
          {m.decidedBy ? <span className="t-dim"> Decided by {m.decidedBy}{m.votes ? `, room ${m.votes.buy} buy ${m.votes.pass} pass` : ""}.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── trades ─────────────────────────────────────────────────────────────────────────────────────────────

function TradesScreen({ t }: { t: TradingDetail }) {
  const a = t.analytics.overall;
  return (
    <>
      <div className="t-tiles">
        <Tile label="Open" value={String(t.positions.length)} sub={`${t.positions.reduce((s, p) => s + p.sizeUsd, 0).toFixed(2)} USD at work`} />
        <Tile label="Closed" value={String(a.trades)} sub={`${a.wins} won, ${a.trades - a.wins} lost or even`} />
        <Tile label="Net" value={usdShort(a.pnlUsd)} sub="USD, all closed trades, after fees" tone={tone(a.pnlUsd)} />
        <Tile label="Average R" value={a.avgR !== null ? rText(a.avgR) : "n/a"} sub="profit per unit of risk taken" tone={a.avgR === null ? "flat" : tone(a.avgR)} />
      </div>
      <Section title={`Open trades (${t.positions.length})`}>
        {t.positions.length === 0 ? <div className="t-dim">Nothing open. The desks wait for a setup worth the risk.</div> : null}
        {t.positions.map((p) => (
          <Position key={p.id} p={p} />
        ))}
      </Section>
      <Section title="Closed trades" right={`last ${Math.min(40, t.trades.length)}`}>
        {t.trades.length === 0 ? <div className="t-dim">None yet.</div> : null}
        {t.trades.slice(0, 40).map((c) => (
          <Trade key={c.id} c={c} />
        ))}
      </Section>
    </>
  );
}

function Trade({ c }: { c: TradeView }) {
  return (
    <details className="t-row trade" style={{ borderLeftColor: DESK_COLOR[c.desk] }}>
      <summary>
        <div className="t-row-top">
          <b>
            {sym(c.symbol)} <span className="t-dim">{DESK_NAME[c.desk] ?? c.desk}, {EXIT[c.reason ?? ""] ?? c.reason ?? "closed"}, held {hours(c.holdHours)}</span>
          </b>
          <span className={`t-num ${tone(c.pnlUsd)}`}>
            {usd(c.pnlUsd)} {c.rMultiple !== null ? <small>{rText(c.rMultiple)}</small> : null}
          </span>
        </div>
        <div className="t-dim">
          {price(c.entry)} to {price(c.exit)}, {pct(c.pnlPct)}, {c.sizeUsd.toFixed(2)} USD, closed {since(c.closedAt)}
        </div>
      </summary>
      {c.thesis ? <div className="t-thesis">{c.thesis}</div> : null}
      {c.meeting ? <CallCard c={{ id: c.id, symbol: c.symbol, market: c.market, desk: c.desk, status: "taken", score: 0, kind: "the call", meeting: c.meeting, at: c.openedAt, outcome: { state: c.pnlUsd > 0 ? "won" : c.pnlUsd < 0 ? "lost" : "even", pnlUsd: c.pnlUsd } }} /> : null}
      {c.reviews.map((r) => (
        <div key={r.at} className="t-dim">
          Review {since(r.at)}: {r.action === "tighten" ? "tightened the stop" : r.action === "close" ? "closed it" : "hold"}. {r.reason} ({r.decidedBy})
        </div>
      ))}
      {c.lesson ? <div className="t-thesis">Coach: {c.lesson}</div> : null}
    </details>
  );
}

// ─── reports ────────────────────────────────────────────────────────────────────────────────────────────

function ReportsScreen({ t }: { t: TradingDetail }) {
  return (
    <>
      {t.briefFull ? (
        <Section title={`Morning brief: ${t.briefFull.mood}`} right={since(t.briefFull.at)}>
          <div className="t-line">
            <b>{t.briefFull.headline}</b>
          </div>
          <div className="t-dim">
            Watch {t.briefFull.watch.map(sym).join(", ") || "nothing special"}. Avoid {t.briefFull.avoid.map(sym).join(", ") || "nothing special"}.
          </div>
          {t.briefFull.notes ? <div className="t-line">{t.briefFull.notes}</div> : null}
        </Section>
      ) : null}
      {t.plan ? (
        <Section title={`Morning meeting: a ${t.plan.mode} day`} right={since(t.plan.at)}>
          <div className="t-line">
            <b>{t.plan.plan}</b>
          </div>
          <div className="t-dim">
            Focus {t.plan.focus.map(sym).join(", ") || "nothing special"}. Avoid {t.plan.avoid.map(sym).join(", ") || "nothing special"}.
          </div>
          {t.plan.strategist ? <div className="t-thesis">Strategist: {t.plan.strategist}</div> : null}
        </Section>
      ) : null}
      {t.memo ? (
        <Section title="The Coach's memo for this week" right={since(t.memo.at)}>
          <div className="t-line">{t.memo.memo}</div>
          <div className="t-dim">Read out at every morning meeting.</div>
        </Section>
      ) : null}
      <Section title="Close reports and report cards" right={`${t.reports.length} kept`}>
        {t.reports.length === 0 ? <div className="t-dim">The first close report is written after the first US session with the floor live. Sunday brings the weekly report card.</div> : null}
        {t.reports.map((r) => (
          <details key={r.at} className="t-row report">
            <summary>
              <div className="t-row-top">
                <b>
                  {r.title} <span className="t-dim">{r.kind === "week" ? "weekly" : "daily"}, {since(r.at)}</span>
                </b>
                <Stamp text={r.kind === "week" ? "WEEK" : "CLOSE"} tone={r.kind === "week" ? "amber" : "dim"} />
              </div>
            </summary>
            <pre className="t-pre">{r.body}</pre>
            {r.extra ? <div className="t-thesis">Coach: {r.extra}</div> : null}
          </details>
        ))}
      </Section>
      {t.lessons.length ? (
        <Section title="What the Coach keeps saying">
          <ul className="t-list">
            {t.lessons.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

// ─── analytics ──────────────────────────────────────────────────────────────────────────────────────────

function Bars({ rows }: { rows: Array<{ label: string; value: number; sub: string }> }) {
  const max = Math.max(0.01, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <div className="t-dim">Nothing closed yet.</div>;
  return (
    <div className="t-bars">
      {rows.map((r) => (
        <div key={r.label} className="t-bar">
          <span className="t-bar-label">{r.label}</span>
          <span className="t-bar-track">
            <i className={tone(r.value)} style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }} />
          </span>
          <span className={`t-bar-value ${tone(r.value)}`}>{usd(r.value)}</span>
          <span className="t-bar-sub">{r.sub}</span>
        </div>
      ))}
    </div>
  );
}

function statRows(map: Record<string, { trades: number; wins: number; pnlUsd: number; avgR: number | null; profitFactor: number | null }>, name: (k: string) => string) {
  return Object.entries(map)
    .sort((a, b) => b[1].pnlUsd - a[1].pnlUsd)
    .map(([k, v]) => ({ label: name(k), value: v.pnlUsd, sub: `${v.wins} of ${v.trades} won${v.avgR !== null ? `, ${rText(v.avgR)} avg` : ""}${v.profitFactor !== null ? `, PF ${v.profitFactor.toFixed(2)}` : ""}` }));
}

function AnalyticsScreen({ t }: { t: TradingDetail }) {
  const a = t.analytics;
  const o = a.overall;
  const dubaiHour = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <>
      <div className="t-tiles">
        <Tile label="Win rate" value={o.trades ? `${Math.round((o.wins / o.trades) * 100)}%` : "n/a"} sub={`${o.wins} of ${o.trades} closed`} tone={o.trades ? (o.wins / o.trades >= 0.5 ? "up" : "down") : "flat"} />
        <Tile label="Profit factor" value={o.profitFactor !== null ? o.profitFactor.toFixed(2) : "n/a"} sub="money won for every 1 USD lost" tone={o.profitFactor === null ? "flat" : o.profitFactor >= 1 ? "up" : "down"} />
        <Tile label="Expectancy" value={o.expectancyUsd !== null ? usdShort(o.expectancyUsd) : "n/a"} sub="USD, average result per trade" tone={tone(o.expectancyUsd)} />
        <Tile label="Average R" value={o.avgR !== null ? rText(o.avgR) : "n/a"} sub="profit per unit of risk" tone={o.avgR === null ? "flat" : tone(o.avgR)} />
        <Tile label="Average hold" value={o.avgHoldHours !== null ? hours(o.avgHoldHours) : "n/a"} sub="from entry to exit" />
        <Tile label="AI spent" value={a.aiVsPnl.aiUsd.toFixed(2)} sub={`USD on AI so far, trades ${usd(a.aiVsPnl.pnlUsd)}`} tone={a.aiVsPnl.pnlUsd - a.aiVsPnl.aiUsd > 0 ? "up" : "amber"} />
      </div>
      {o.best || o.worst ? (
        <div className="t-line">
          {o.best ? <span>Best trade {sym(o.best.symbol)} {usd(o.best.pnlUsd)}. </span> : null}
          {o.worst ? <span>Worst trade {sym(o.worst.symbol)} {usd(o.worst.pnlUsd)}.</span> : null}
        </div>
      ) : null}
      <Section title="Desks against the yardsticks" right="S&P 500 and Bitcoin held, dashed">
        <Curves curves={t.curves} start={t.startUsd} bench={t.bench} />
        <div className="t-dim">
          Deepest fall from a peak:{" "}
          {t.desks.map((d) => `${d.name} ${(a.drawdownPct[d.slug] ?? 0).toFixed(2)}%`).join(", ")}.
        </div>
      </Section>
      <Section title="By desk">
        <Bars rows={statRows(a.byDesk, (k) => DESK_NAME[k] ?? k)} />
      </Section>
      <Section title="By signal kind">
        <Bars rows={statRows(a.byKind, (k) => k)} />
        {Object.keys(t.kinds).length ? <div className="t-dim">Scanner memory: {Object.entries(t.kinds).map(([k, r]) => `${k} ${r.wins} won ${r.losses} lost`).join(", ")}. A kind that keeps losing needs a stronger setup to get a meeting.</div> : null}
      </Section>
      <Section title="By sector">
        <Bars rows={statRows(a.bySector, (k) => k)} />
      </Section>
      <Section title="By hour of entry" right="Dubai time">
        <Bars rows={a.byHour.map((h) => ({ label: dubaiHour(h.hour), value: h.pnlUsd, sub: `${h.trades} trade${h.trades === 1 ? "" : "s"}` }))} />
      </Section>
      <Section title="Who to listen to" right="right on the last 20 votes">
        {t.voices.length === 0 ? <div className="t-dim">No record yet. Every closed trade scores the voices that spoke on it.</div> : null}
        {t.voices.map((v) => (
          <div key={v.who} className="t-bar">
            <span className="t-bar-label">{v.who}</span>
            <span className="t-bar-track">
              <i className={v.right / v.of >= 0.6 ? "up" : v.right / v.of < 0.45 ? "down" : "flat"} style={{ width: `${Math.round((v.right / v.of) * 100)}%` }} />
            </span>
            <span className="t-bar-value">
              {v.right} of {v.of}
            </span>
            <span className="t-bar-sub">{v.allRight} of {v.allOf} ever</span>
          </div>
        ))}
      </Section>
    </>
  );
}
