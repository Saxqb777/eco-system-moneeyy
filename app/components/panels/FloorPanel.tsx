"use client";

import { useState } from "react";
import type { FloorDetail } from "@/lib/detail";
import { Empty, Key, Pill, Sheet, post, since, usd, usePoll, when } from "./shared";

// The floor panel body: goal meter, crew, active work, blockers, money, Warden's note, pause and resume.
export function FloorBody({ slug, onAgent, onSetup }: { slug: string; onAgent?: (id: string) => void; onSetup?: () => void }) {
  const { data, error, reload } = usePoll<{ floor: FloorDetail }>(`/api/floors/${slug}`, 5000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const f = data?.floor ?? null;
  if (error && !f) return <Empty>{error}</Empty>;
  if (!f) return <Empty>Reading the floor</Empty>;

  async function toggle() {
    if (!f || busy) return;
    setBusy(true);
    const res = await post(`/api/floors/${f.slug}`, { action: f.status === "paused" ? "resume" : "pause" });
    setBusy(false);
    setNote(res.ok ? (res.status === "paused" ? "Floor paused. The crew waits at their desks." : "Floor running again.") : (res.error ?? "Could not change the floor"));
    reload();
    setTimeout(() => setNote(""), 3000);
  }

  const pct = f.weeklyTarget > 0 ? Math.min(100, Math.round((f.weeklyActual / f.weeklyTarget) * 100)) : 0;

  return (
    <>
      {f.status === "locked" ? (
        <Sheet title="Locked">
          <div>{f.unlockRule ?? "Not open yet."}</div>
          <div className="muted">Dust sheets stay on until the rule is met. Warden checks it every run.</div>
        </Sheet>
      ) : null}
      {f.status === "paused" ? (
        <Sheet title="Paused">
          <div className="alert">{f.pausedReason ?? "Paused"}</div>
        </Sheet>
      ) : null}
      {f.throttledUntil ? (
        <Sheet title="Throttled">
          <div className="alert">Slowed to 40 percent until {when(f.throttledUntil)}: the daily cap is close.</div>
        </Sheet>
      ) : null}

      {f.isBusiness || f.slug === "penthouse" ? (
        <Sheet title="Goal" accent={f.accent}>
          <div className="goal-line">
            <span className="goal-metric">{f.goalMetric}</span>
            <span className="goal-num">
              {f.weeklyTarget > 0 ? `${f.weeklyActual} of ${f.weeklyTarget} ${f.targetUnit}` : `${f.weeklyActual} ${f.targetUnit}`}
            </span>
          </div>
          {f.weeklyTarget > 0 ? (
            <div className="meter">
              <i style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          <div className="muted">{f.measure}. Week starts Monday, Dubai time.</div>
          {f.niche ? <div className="muted">Niche: {f.niche}</div> : null}
        </Sheet>
      ) : null}

      {f.missingSetup.length ? (
        <Sheet title="Runs simulated until">
          <ul className="plain">
            {f.missingSetup.map((m) => (
              <li key={m.key}>{m.label}</li>
            ))}
          </ul>
          {onSetup ? (
            <Key small onClick={onSetup}>
              Open the clipboard
            </Key>
          ) : null}
        </Sheet>
      ) : null}

      {f.agents.length ? (
        <Sheet title="Crew">
          <ul className="crew">
            {f.agents.map((a) => (
              <li key={a.id}>
                <button className="linkish strong" onClick={() => onAgent?.(a.id)}>
                  {a.name}
                </button>
                <span className="muted"> {a.role}</span>
                <Pill status={a.status} />
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}

      {f.blockers.length ? (
        <Sheet title="Blockers">
          {f.blockers.map((b) => (
            <div key={b.taskId} className="alert">
              {b.agentName}: {b.reason} <span className="muted">({since(b.since)} ago, on {b.title})</span>
            </div>
          ))}
        </Sheet>
      ) : null}

      {f.status !== "locked" ? (
        <Sheet title={`Active work${f.queued ? `, ${f.queued} queued` : ""}`}>
          {f.activeTasks.length === 0 ? <div className="muted">Nobody is mid task right now.</div> : null}
          <ul className="history">
            {f.activeTasks.map((t) => (
              <li key={t.id}>
                <div className="h-top">
                  <span className="h-title">{t.title}</span>
                  <Pill status={t.status} />
                </div>
                <div className="muted">
                  {t.agentName}
                  {t.startedAt ? `, since ${when(t.startedAt)}` : ""}
                </div>
              </li>
            ))}
          </ul>
          <div className="muted">{f.doneThisWeek} tasks done this week.</div>
        </Sheet>
      ) : null}

      {f.isBusiness ? (
        <Sheet title="Money">
          <dl className="kv">
            <dt>Revenue this week</dt>
            <dd className={f.simulated ? "sim" : "real"}>{usd(f.money.revenueWeekUsd)}</dd>
            <dt>Revenue all time</dt>
            <dd className={f.simulated ? "sim" : "real"}>{usd(f.money.revenueTotalUsd)}</dd>
            <dt>Spend this week</dt>
            <dd>{usd(f.money.spendWeekUsd)}</dd>
            <dt>Spend today</dt>
            <dd>{usd(f.money.spendTodayUsd)}</dd>
            {f.monthlyGuideUsd ? (
              <>
                <dt>Monthly guide</dt>
                <dd>{usd(f.monthlyGuideUsd)}</dd>
              </>
            ) : null}
          </dl>
          {f.simulated ? <div className="stamp-s">Simulated</div> : null}
        </Sheet>
      ) : null}

      {f.strategyNote ? (
        <Sheet title="Warden's note" clip>
          <div className="note-text">{f.strategyNote}</div>
          <div className="muted">Written {when(f.strategyUpdatedAt)}</div>
        </Sheet>
      ) : null}

      {f.status !== "locked" ? (
        <div className="actions">
          <Key onClick={() => void toggle()} disabled={busy} tone={f.status === "paused" ? "ok" : "bad"}>
            {f.status === "paused" ? "Resume floor" : "Pause floor"}
          </Key>
          {note ? <span className="note-s light">{note}</span> : null}
        </div>
      ) : null}
    </>
  );
}
