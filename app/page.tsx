import { getDb } from "@/db/client";
import { formatUsd } from "@/lib/money";
import { getTowerState } from "@/lib/state";
import { asBool, getSettings } from "@/lib/settings";
import { formatDubai } from "@/lib/time";
import { runSimulation } from "@/sim/generator";
import SimControls from "./components/SimControls";

export const dynamic = "force-dynamic";

// TEMPORARY. Phase 1 status page so the data flow can be checked. The PixiJS game replaces this in Phase 2.
export default async function StatusPage() {
  const db = getDb();
  // Keep the building alive on open: catch the simulation up before reading the state.
  const settingsMap = await getSettings(db);
  if (asBool(settingsMap.simulation_mode, true)) {
    await runSimulation(db, new Date(), { maxSlices: 36 }).catch(() => null);
  }
  const state = await getTowerState(db);
  const money = state.simulationMode ? state.money.simulated : state.money.real;
  const cls = state.simulationMode ? "sim" : "real";
  const stamp = state.simulationMode ? <span className="stamp">SIMULATED</span> : null;

  return (
    <main>
      <h1>The Tower</h1>
      <p className="temp">
        Temporary Phase 1 status page. The game view arrives in Phase 2. {formatDubai(new Date(state.now))}, {state.dubai.night ? "night" : "day"}.
      </p>
      <SimControls simulationMode={state.simulationMode} />

      <div className="counters">
        <div className="counter"><div className="label">Net {stamp}</div><div className={`value ${cls}`}>{formatUsd(money.netUsd)} USD</div></div>
        <div className="counter"><div className="label">Spend today {stamp}</div><div className={`value ${cls}`}>{formatUsd(money.spendTodayUsd)} USD</div></div>
        <div className="counter"><div className="label">Verified revenue {stamp}</div><div className={`value ${cls}`}>{formatUsd(money.verifiedRevenueUsd)} USD</div></div>
        <div className="counter"><div className="label">Daily cap</div><div className="value">{formatUsd(state.budget.dailyCapUsd)} USD</div></div>
        <div className="counter"><div className="label">Budget level</div><div className="value">{state.budget.level}</div></div>
        <div className="counter"><div className="label">Pending approvals</div><div className="value">{state.pendingApprovals}</div></div>
      </div>

      <h2>Building</h2>
      {state.floors.map((f) => (
        <div key={f.id} className={`floor ${f.status}`} style={{ ["--accent" as string]: f.accent }}>
          <h3>
            Level {f.level}: {f.name} <span className="status">{f.status}</span>
            {f.throttled ? <span className="status blocked">throttled</span> : null}
          </h3>
          <div className="meta">
            {f.goalMetric}, weekly target {f.weeklyTarget} {f.targetUnit}
            {f.unlockRule ? ` | ${f.unlockRule}` : ""}
            {f.missingSetup.length ? ` | greyed until: ${f.missingSetup.join(", ")}` : ""}
            {f.strategyNote ? ` | Warden: ${f.strategyNote}` : ""}
          </div>
          {f.agents.length ? (
            <div className="agents">
              {f.agents.map((a) => (
                <div key={a.id} className="agent">
                  <span className="name">{a.name}</span> <span className={`status ${a.status}`}>{a.status}</span>
                  <div className="note">{a.role}, level {a.locationLevel}, {a.stats.tasksDone} done, {a.stats.successRate}% success{a.stats.avgReviewScore ? `, ${a.stats.avgReviewScore}/10` : ""}</div>
                  {a.currentTask ? <div className="task">{a.currentTask.title}{a.currentTask.blockedReason ? ` (${a.currentTask.blockedReason})` : ""}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <h2>Live log</h2>
      <ul className="events">
        {state.recentEvents.map((e) => (
          <li key={e.id}><time>{formatDubai(new Date(e.createdAt))}</time>{e.message}</li>
        ))}
        {state.recentEvents.length === 0 ? <li>No events yet. Press Run simulation step.</li> : null}
      </ul>

      <h2>Setup clipboard</h2>
      <table>
        <thead><tr><th>Item</th><th>Status</th><th>Hint</th></tr></thead>
        <tbody>
          {state.setup.map((s) => (
            <tr key={s.key}><td>{s.label}</td><td><span className={`pill ${s.status}`}>{s.status}</span></td><td className="note">{s.hint ?? ""}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>Heartbeat</h2>
      <table>
        <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Error</th></tr></thead>
        <tbody>
          {state.lastTicks.map((t) => (
            <tr key={t.id}><td>{formatDubai(new Date(t.startedAt))}</td><td>{t.trigger}</td><td>{t.status}</td><td className="note">{t.error ?? ""}</td></tr>
          ))}
          {state.lastTicks.length === 0 ? <tr><td colSpan={4}>No ticks yet. The hourly cron will show here.</td></tr> : null}
        </tbody>
      </table>
    </main>
  );
}
