"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentDetail } from "@/lib/detail";
import type { TowerScene } from "@/scene/TowerScene";
import { Empty, Key, Pill, Sheet, post, since, usd, usePoll, when } from "./shared";

// The character panel body: portrait, editable name plate, what they are doing, live log, cost, stats, history.
export function CharacterBody({ agentId, scene, onFloor }: { agentId: string; scene: TowerScene | null; onFloor?: (slug: string) => void }) {
  const { data, error, reload } = usePoll<{ agent: AgentDetail }>(`/api/agents/${agentId}`, 5000);
  const [img, setImg] = useState<string | null>(null);
  const logRef = useRef<HTMLUListElement>(null);
  const agent = data?.agent ?? null;

  useEffect(() => {
    let live = true;
    setImg(null);
    scene?.portrait(agentId).then((src) => {
      if (live) setImg(src);
    });
    return () => {
      live = false;
    };
  }, [agentId, scene]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent?.log.length]);

  if (error && !agent) return <Empty>{error}</Empty>;
  if (!agent) return <Empty>Reading the desk</Empty>;
  const task = agent.currentTask;
  const warden = agent.kind === "warden";

  return (
    <>
      <div className="who">
        <div className="portrait">{img ? <img src={img} alt="" /> : null}</div>
        <div className="who-text">
          <NamePlate id={agent.id} name={agent.name} onSaved={reload} />
          <div className="who-role">
            {warden ? "The boss" : `${titleRole(agent.role)}, ${agent.modelKey === "worker" ? "worker model" : agent.modelKey === "builder" ? "builder model" : "warden model"}`}
          </div>
          <div className="who-meta">
            {agent.floor ? (
              <button className="linkish" onClick={() => agent.floor && onFloor?.(agent.floor.slug)}>
                {agent.floor.name}
              </button>
            ) : null}
            <Pill status={agent.status} />
          </div>
        </div>
      </div>

      <Sheet title="Now">
        {task ? (
          <>
            <div className="task-title">{task.title}</div>
            <div className="muted">
              {task.status === "blocked" ? "Waiting for help" : "In progress"}
              {task.startedAt ? `, started ${when(task.startedAt)}${since(task.startedAt) === "just now" ? "" : ` (${since(task.startedAt)} ago)`}` : ""}
            </div>
            {task.blockedReason ? <div className="alert">Blocked: {task.blockedReason}</div> : null}
            {task.feedback ? <div className="muted">Redo with feedback: {task.feedback}</div> : null}
          </>
        ) : (
          <div className="muted">{warden ? "At the desk in the penthouse, reviewing the floors." : agent.status === "paused" ? "Floor paused. Waiting at the desk." : "Nothing assigned right now."}</div>
        )}
      </Sheet>

      <div className="log-wrap">
        <h3 className="dark-h">Live log</h3>
        <ul className="log" ref={logRef}>
          {agent.log.length === 0 ? <li className="dim">Quiet so far.</li> : null}
          {agent.log.map((e) => (
            <li key={e.id} className={e.type}>
              <time>{when(e.createdAt)}</time>
              {e.message}
            </li>
          ))}
        </ul>
      </div>

      <div className="two">
        <Sheet title="Today">
          <dl className="kv">
            <dt>Runs</dt>
            <dd>{agent.today.runs}</dd>
            <dt>Tokens in</dt>
            <dd>{agent.today.inputTokens.toLocaleString("en-GB")}</dd>
            <dt>Tokens out</dt>
            <dd>{agent.today.outputTokens.toLocaleString("en-GB")}</dd>
            <dt>Cache reads</dt>
            <dd>{agent.today.cacheReadTokens.toLocaleString("en-GB")}</dd>
            {agent.today.webSearches ? (
              <>
                <dt>Web searches</dt>
                <dd>{agent.today.webSearches}</dd>
              </>
            ) : null}
            <dt>Cost</dt>
            <dd className={agent.simulated ? "sim" : "real"}>{usd(agent.today.costUsd)}</dd>
          </dl>
          {agent.simulated ? <div className="stamp-s">Simulated</div> : null}
        </Sheet>
        <Sheet title="Stats">
          <dl className="kv">
            <dt>Tasks done</dt>
            <dd>{agent.stats.tasksDone}</dd>
            <dt>Sent back</dt>
            <dd>{agent.stats.tasksFailed}</dd>
            <dt>Success</dt>
            <dd>{agent.stats.successRate}%</dd>
            <dt>Review score</dt>
            <dd>{agent.stats.avgReviewScore === null ? "none yet" : `${agent.stats.avgReviewScore} / 10`}</dd>
          </dl>
        </Sheet>
      </div>

      {!warden ? (
        <Sheet title="History">
          {agent.history.length === 0 ? <div className="muted">No tasks yet.</div> : null}
          <ul className="history">
            {agent.history.map((h) => (
              <li key={h.id}>
                <div className="h-top">
                  <span className="h-title">{h.title}</span>
                  <Pill status={h.status} />
                </div>
                <div className="muted">
                  {when(h.finishedAt ?? h.startedAt)}
                  {h.reviewScore !== null ? `, scored ${h.reviewScore}/10` : ""}
                  {h.summary ? `: ${h.summary}` : ""}
                </div>
                {h.status === "rejected" && h.reviewReason ? <div className="alert">{h.reviewReason}</div> : null}
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}

function titleRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// Click the brass name plate to rename. Enter saves to the database, Escape cancels.
function NamePlate({ id, name, onSaved }: { id: string; name: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  async function save() {
    if (busy) return;
    setBusy(true);
    const res = await post(`/api/agents/${id}`, { name: draft }, "PATCH");
    setBusy(false);
    if (!res.ok) {
      setNote(res.error ?? "Could not save");
      return;
    }
    setNote("Saved on the plate");
    setEditing(false);
    onSaved();
    setTimeout(() => setNote(""), 2500);
  }

  if (editing) {
    return (
      <div className="nameplate-edit">
        <input
          className="field nameplate-input"
          value={draft}
          maxLength={24}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <Key small onClick={() => void save()} disabled={busy}>
          Save
        </Key>
        <Key small tone="plain" onClick={() => setEditing(false)}>
          Cancel
        </Key>
        {note ? <span className="note-s">{note}</span> : null}
      </div>
    );
  }
  return (
    <div className="nameplate-row">
      <button className="nameplate" onClick={() => setEditing(true)} title="Click to rename">
        {name}
      </button>
      {note ? <span className="note-s">{note}</span> : <span className="note-s dim">click to rename</span>}
    </div>
  );
}
