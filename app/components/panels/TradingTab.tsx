"use client";

import { useState } from "react";
import type { TradingDetail } from "@/trading/view";
import { Empty, Key, Sheet, post, since, usePoll, when } from "./shared";

const DESK_COLOR: Record<string, string> = { ai_stocks: "#1fa35b", ai_crypto: "#3a86c8", quant: "#9b59b6", index: "#c9963b" };
const DESK_NAME: Record<string, string> = { ai_stocks: "AI Desk", ai_crypto: "Night Desk", quant: "Quant Bot", index: "Lazy Larry" };
const EXIT: Record<string, string> = { target: "target hit", stop: "stop loss", breakeven: "out at the entry", trail: "trailing stop", time: "closed on time", manual: "closed" };

// Percent as words and arrows, never a minus sign (rule 7).
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (Math.abs(v) < 0.005) return "flat";
  return `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(2)}%`;
}

function money(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  if (Math.abs(v) < 0.005) return "even";
  return `${v > 0 ? "won" : "lost"} ${Math.abs(v).toFixed(2)}`;
}

function price(p: number | null | undefined): string {
  if (p === null || p === undefined) return "n/a";
  return p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

const tone = (v: number | null | undefined) => (v === null || v === undefined || Math.abs(v) < 0.005 ? "" : v > 0 ? "up" : "down");

// Every desk's money over time against the 100 USD start line.
function Curves({ curves, start }: { curves: TradingDetail["curves"]; start: number }) {
  const all = curves.flatMap((c) => c.points);
  if (all.length < 2) return <div className="muted">The chart fills in as the desks trade: one point every 15 minutes.</div>;
  const times = all.map((p) => new Date(p.at).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times, t0 + 1);
  const vals = [...all.map((p) => p.v), start];
  const lo = Math.min(...vals) - 0.3;
  const hi = Math.max(...vals) + 0.3;
  const W = 340;
  const H = 130;
  const x = (at: string) => 4 + ((new Date(at).getTime() - t0) / (t1 - t0)) * (W - 8);
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trade-chart" role="img" aria-label="Desk money over time">
      <line x1={0} x2={W} y1={y(start)} y2={y(start)} className="start-line" />
      {curves.map((c) =>
        c.points.length > 1 ? (
          <polyline key={c.slug} fill="none" stroke={DESK_COLOR[c.slug] ?? "#888"} strokeWidth={c.slug === "index" ? 1.6 : 2} strokeDasharray={c.slug === "index" ? "4 3" : undefined} points={c.points.map((p) => `${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
        ) : null,
      )}
    </svg>
  );
}

// The trading room's transcript: every voice with its vote, then the Chief and whose argument decided it.
function Meeting({ m }: { m: unknown }) {
  const v = (m ?? {}) as { voices?: Array<{ who: string; say: string; vote: string }>; votes?: { buy: number; pass: number }; decision?: string; reason?: string; decidedBy?: string };
  const voices = (v.voices ?? []).filter((x) => x.who !== "Chief");
  if (!voices.length && !v.decision) return null;
  return (
    <div className="meeting">
      {voices.map((x) => (
        <div key={x.who}>
          <b className={x.vote === "buy" ? "bull" : "bear"}>
            {x.who} {x.vote === "buy" ? "\u25B2" : "\u25BC"}
          </b>{" "}
          {x.say}
        </div>
      ))}
      {v.decision ? (
        <div className="chief-line">
          <b>Chief</b> {v.decision === "buy" ? "BUY" : "PASS"}
          {v.reason ? `: ${v.reason}` : ""}
          {v.decidedBy ? <span className="muted"> Decided by {v.decidedBy}{v.votes ? `, room ${v.votes.buy} buy ${v.votes.pass} pass` : ""}.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// Wall Street (D075): the race between the desks, what they hold, what they argued about and what they learned.
export function TradingTab() {
  const q = usePoll<{ trading: TradingDetail | null }>("/api/trading", 10000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const t = q.data?.trading;
  if (!t) return <Empty>{q.error ?? (q.data ? "The floor opens on its first pulse, within 5 minutes." : "Reading the tape")}</Empty>;
  const s = t.status;
  const larry = t.desks.find((d) => d.slug === "index");

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
    <>
      <Sheet title="The race">
        {t.desks.map((d, i) => (
          <div key={d.slug} className={`race-row ${d.status}`} style={{ borderLeftColor: DESK_COLOR[d.slug] }}>
            <div className="h-top">
              <b>
                {i + 1}. {d.name}{" "}
                <span className="muted">
                  {d.market === "crypto" ? "crypto" : "US stocks"}, {d.style === "ai" ? "AI crew" : d.style === "quant" ? "rules only" : "buys and holds"}
                </span>
              </b>
              <span className={`race-pct ${tone(d.pnlPct)}`}>{pct(d.pnlPct)}</span>
            </div>
            <div className="muted">
              {d.equityUsd.toFixed(2)} of {t.startUsd} USD, {d.open} open{d.status !== "live" ? `, ${d.status}` : ""}
              {larry && d.slug !== "index" ? `, ${d.pnlPct >= larry.pnlPct ? "ahead of" : "behind"} Larry by ${Math.abs(d.pnlPct - larry.pnlPct).toFixed(2)} points` : ""}
            </div>
          </div>
        ))}
        {t.btcPct !== null ? <div className="muted">Bitcoin held since the start: {pct(t.btcPct)}. The Night Desk's yardstick.</div> : null}
        <Curves curves={t.curves} start={t.startUsd} />
        <div className="legend">
          {Object.entries(DESK_NAME).map(([slug, name]) => (
            <span key={slug}>
              <i style={{ background: DESK_COLOR[slug] }} /> {name}
            </span>
          ))}
        </div>
      </Sheet>

      <Sheet title="Market and money">
        <dl className="kv">
          <dt>US stocks</dt>
          <dd>{s ? (s.stocksOpen ? "open" : s.stocksLive ? `closed, opens ${when(s.nextOpen)}` : "waiting for the Alpaca keys") : "not read yet"}</dd>
          <dt>Crypto</dt>
          <dd>{s ? (s.cryptoLive ? "trading, 24 hours a day" : "no prices yet") : "not read yet"}</dd>
          <dt>Prices from</dt>
          <dd>{s ? (s.source === "sim" ? "made up market (simulation)" : "Alpaca, real prices") : "n/a"}</dd>
          <dt>AI money today</dt>
          <dd>
            {(s?.aiSpentUsd ?? 0).toFixed(2)} of {(s?.aiLimitUsd ?? 0.35).toFixed(2)} USD
          </dd>
          <dt>AI money so far</dt>
          <dd>{t.aiCost.totalUsd.toFixed(2)} USD</dd>
          <dt>Today</dt>
          <dd>
            {t.stats.signalsToday} signals, {t.stats.meetingsToday} meetings
          </dd>
          <dt>Win rate</dt>
          <dd>{t.stats.winRate !== null ? `${t.stats.winRate}% of ${t.stats.tradesTotal} trades` : "no closed trades yet"}</dd>
          <dt>Last look</dt>
          <dd>{s ? since(s.at) : "never"}</dd>
        </dl>
        {s?.errors.length ? <div className="alert">{s.errors[0]}</div> : null}
        <div className="row-keys">
          <Key small onClick={() => void runNow()} disabled={busy}>
            {busy ? "Looking" : "Run the floor now"}
          </Key>
          {note ? <span className="muted">{note}</span> : null}
        </div>
      </Sheet>

      {t.plan ? (
        <Sheet title={`Morning meeting: a ${t.plan.mode} day`}>
          <b>{t.plan.plan}</b>
          <div className="muted">
            Focus {t.plan.focus.map((x) => x.replace("/USD", "")).join(", ") || "nothing special"}. Avoid {t.plan.avoid.map((x) => x.replace("/USD", "")).join(", ") || "nothing special"}.
          </div>
          {t.plan.strategist ? <div className="thesis">Strategist: {t.plan.strategist}</div> : null}
        </Sheet>
      ) : null}

      {t.briefFull ? (
        <Sheet title={`Morning brief: ${t.briefFull.mood}`}>
          <b>{t.briefFull.headline}</b>
          <div className="muted">
            Watch {t.briefFull.watch.join(", ") || "nothing special"}. Avoid {t.briefFull.avoid.join(", ") || "nothing special"}.
          </div>
          {t.briefFull.notes ? <div>{t.briefFull.notes}</div> : null}
        </Sheet>
      ) : null}

      <Sheet title={`Open trades (${t.positions.length})`}>
        {t.positions.length === 0 ? <div className="muted">Nothing open. The desks wait for a setup worth the risk.</div> : null}
        {t.positions.map((p) => (
          <div key={p.id} className="trade-row" style={{ borderLeftColor: DESK_COLOR[p.desk] }}>
            <div className="h-top">
              <b>
                {p.symbol.replace("/USD", "")} <span className="muted">{DESK_NAME[p.desk] ?? p.desk}, {p.sizeUsd.toFixed(2)} USD</span>
              </b>
              <span className={`race-pct ${tone(p.pnlPct)}`}>{pct(p.pnlPct)}</span>
            </div>
            <div className="muted">
              Bought {price(p.entry)}, now {price(p.last)}
              {p.stop !== null ? `, stop ${price(p.stop)}` : ""}
              {p.target !== null ? `, target ${price(p.target)}` : ""}, {since(p.openedAt)}
            </div>
            {p.thesis ? <div className="thesis">{p.thesis}</div> : null}
            {p.reviews.map((r) => (
              <div key={r.at} className="muted">
                Review {since(r.at)}: {r.action === "tighten" ? "tightened the stop" : r.action === "close" ? "closed it" : "hold"}. {r.reason} ({r.decidedBy})
              </div>
            ))}
          </div>
        ))}
      </Sheet>

      <Sheet title="Latest meetings">
        {t.meetings.length === 0 ? <div className="muted">No meetings yet. The Chief calls one when the Quant flags a strong setup.</div> : null}
        {t.meetings.slice(0, 8).map((m) => (
          <div key={m.id} className={`trade-row ${m.status}`}>
            <div className="h-top">
              <b>
                {m.symbol.replace("/USD", "")} <span className="muted">{m.kind}, score {m.score}</span>
              </b>
              <span className="pill-s">{m.status}</span>
            </div>
            <Meeting m={m.meeting} />
            <div className="muted">{since(m.at)}</div>
          </div>
        ))}
      </Sheet>

      <Sheet title="Closed trades">
        {t.trades.length === 0 ? <div className="muted">None yet.</div> : null}
        {t.trades.slice(0, 15).map((c) => (
          <div key={c.id} className="trade-row" style={{ borderLeftColor: DESK_COLOR[c.desk] }}>
            <div className="h-top">
              <b>
                {c.symbol.replace("/USD", "")} <span className="muted">{DESK_NAME[c.desk] ?? c.desk}, {EXIT[c.reason ?? ""] ?? c.reason}</span>
              </b>
              <span className={`race-pct ${tone(c.pnlUsd)}`}>{money(c.pnlUsd)} USD</span>
            </div>
            <div className="muted">
              {price(c.entry)} to {price(c.exit)}, {pct(c.pnlPct)}, {since(c.closedAt)}
            </div>
            {c.lesson ? <div className="thesis">Coach: {c.lesson}</div> : null}
          </div>
        ))}
      </Sheet>

      {t.lessons.length ? (
        <Sheet title="What the Coach keeps saying">
          <ul className="plain">
            {t.lessons.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Sheet>
      ) : null}

      <Sheet>
        <div className="muted">
          Paper money only: no real order is ever placed. After 6 to 8 weeks, a desk that beats Lazy Larry after costs can be tried with small real money, and every real trade would wait for your approval.
        </div>
      </Sheet>
    </>
  );
}
