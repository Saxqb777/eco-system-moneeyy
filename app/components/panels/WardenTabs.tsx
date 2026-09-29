"use client";

import { useState } from "react";
import type { WardenSummary } from "@/lib/detail";
import { APPROVAL_TYPES, Empty, Key, Pill, Sheet, post, since, usd, usePoll, when } from "./shared";

interface ApprovalRow {
  id: string;
  type: string;
  status: string;
  summary: string;
  content: Record<string, unknown>;
  previewUrl: string | null;
  riskNote: string | null;
  feedback: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedVia: string | null;
}

// The red phone: every pending item with approve, reject and a feedback line.
export function ApprovalsTab({ onChanged }: { onChanged?: () => void }) {
  const pending = usePoll<{ approvals: ApprovalRow[] }>("/api/approvals?status=pending", 5000);
  const decided = usePoll<{ approvals: ApprovalRow[] }>("/api/approvals?status=decided", 15000);
  const [showDecided, setShowDecided] = useState(false);
  const rows = pending.data?.approvals ?? [];
  if (pending.error && !pending.data) return <Empty>{pending.error}</Empty>;
  if (!pending.data) return <Empty>Picking up the phone</Empty>;
  return (
    <>
      {rows.length === 0 ? (
        <Sheet title="Nothing waiting">
          <div className="muted">The red phone is quiet. Warden calls when a worker needs a yes.</div>
        </Sheet>
      ) : null}
      {rows.map((a) => (
        <ApprovalCard
          key={a.id}
          a={a}
          onDone={() => {
            pending.reload();
            decided.reload();
            onChanged?.();
          }}
        />
      ))}
      <div className="actions">
        <Key small tone="plain" onClick={() => setShowDecided((v) => !v)}>
          {showDecided ? "Hide decided" : "Show decided"}
        </Key>
      </div>
      {showDecided ? (
        <Sheet title="Decided lately">
          {(decided.data?.approvals ?? []).length === 0 ? <div className="muted">No decisions yet.</div> : null}
          <ul className="history">
            {(decided.data?.approvals ?? []).map((a) => (
              <li key={a.id}>
                <div className="h-top">
                  <span className="h-title">{a.summary}</span>
                  <Pill status={a.status} />
                </div>
                <div className="muted">
                  {when(a.decidedAt)} via {a.decidedVia ?? "unknown"}
                  {a.feedback ? `: ${a.feedback}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}

function ApprovalCard({ a, onDone }: { a: ApprovalRow; onDone: () => void }) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  async function decide(decision: "approved" | "rejected") {
    if (busy) return;
    if (decision === "rejected" && !feedback.trim()) {
      setNote("Write one line of feedback so the worker can redo it.");
      return;
    }
    setBusy(true);
    const res = await post("/api/approvals", { id: a.id, decision, feedback: feedback.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      setNote(res.error ?? "Could not record that");
      return;
    }
    onDone();
  }

  const c = a.content ?? {};
  return (
    <Sheet className="approval">
      <div className="type">{APPROVAL_TYPES[a.type] ?? a.type}</div>
      <div className="task-title">{a.summary}</div>
      <div className="muted">Asked {since(a.createdAt)} ago</div>
      {a.riskNote ? <div className="risk">Risk: {a.riskNote}</div> : null}
      <button className="linkish" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide the full content" : "Read the full content"}
      </button>
      {open ? (
        <pre>
          {a.type === "outreach_email"
            ? `To: ${String(c.to ?? "")}\nSubject: ${String(c.subject ?? "")}\n\n${String(c.body ?? "")}`
            : a.type === "public_post"
              ? String(c.body ?? "")
              : a.type === "pull_request"
                ? `${String(c.title ?? "")}\nBranch: ${String(c.branch ?? "")}\nTests: ${String(c.tests ?? "")}\nFiles changed: ${String(c.filesChanged ?? "")}`
                : JSON.stringify(c, null, 2)}
        </pre>
      ) : null}
      {a.previewUrl ? (
        <div>
          <a className="linkish" href={a.previewUrl} target="_blank" rel="noreferrer">
            Open the preview
          </a>
        </div>
      ) : null}
      <input className="field" placeholder="Feedback (required to reject)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <div className="actions">
        <Key tone="ok" onClick={() => void decide("approved")} disabled={busy}>
          Approve
        </Key>
        <Key tone="bad" onClick={() => void decide("rejected")} disabled={busy}>
          Reject
        </Key>
        {note ? <span className="note-s">{note}</span> : null}
      </div>
    </Sheet>
  );
}

interface SetupRow {
  key: string;
  label: string;
  howTo: string;
  kind: string;
  requiredFor: string[];
  status: string;
  hint: string | null;
  providedAt: string | null;
}

// The clipboard: every item Saaqib has to provide, with a paste box. Values never come back out.
export function SetupTab() {
  const { data, error, reload } = usePoll<{ items: SetupRow[] }>("/api/setup", 10000);
  if (error && !data) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Fetching the clipboard</Empty>;
  const items = data.items;
  const present = items.filter((i) => i.status === "present").length;
  return (
    <>
      <Sheet clip title={`Setup: ${present} of ${items.length} on the board`}>
        <div className="muted">Paste a value and press Save. Secrets are encrypted and never shown again, only a hint stays.</div>
      </Sheet>
      {items.map((i) => (
        <SetupItem key={i.key} item={i} onSaved={reload} />
      ))}
    </>
  );
}

function SetupItem({ item, onSaved }: { item: SetupRow; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const present = item.status === "present";

  async function save(clear = false) {
    if (busy) return;
    if (!clear && !value.trim()) {
      setNote("Paste the value first.");
      return;
    }
    setBusy(true);
    const res = await post("/api/setup", clear ? { key: item.key, clear: true } : { key: item.key, value });
    setBusy(false);
    if (!res.ok) {
      setNote(res.error ?? "Could not save");
      return;
    }
    setValue("");
    setNote(clear ? "Cleared" : "Saved on the clipboard");
    onSaved();
    setTimeout(() => setNote(""), 2500);
  }

  return (
    <Sheet className={`setup-item ${present ? "present" : ""}`}>
      <div className="h-top">
        <span className="h-title">{item.label}</span>
        <Pill status={present ? "present" : "missing"}>{present ? "On the board" : "Missing"}</Pill>
      </div>
      <div className="muted">{item.howTo}</div>
      {present ? (
        <div className="hint">
          {item.hint ?? "saved"}
          {item.providedAt ? <span className="muted"> since {when(item.providedAt)}</span> : null}
        </div>
      ) : null}
      <div className="paste-row">
        <input
          className="field"
          type={item.kind === "secret" ? "password" : "text"}
          placeholder={present ? "Paste a new value to replace it" : item.kind === "url" ? "https://" : "Paste here"}
          value={value}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <Key small onClick={() => void save()} disabled={busy}>
          Save
        </Key>
        {present ? (
          <Key small tone="bad" onClick={() => void save(true)} disabled={busy}>
            Clear
          </Key>
        ) : null}
      </div>
      {note ? <span className="note-s">{note}</span> : null}
    </Sheet>
  );
}

// The morning brief, built from data. Same lines go to Telegram from Phase 4.
export function BriefTab({ warden }: { warden: WardenSummary | null }) {
  if (!warden) return <Empty>Warden is writing</Empty>;
  const b = warden.brief;
  const cls = b.simulated ? "sim" : "real";
  return (
    <>
      <Sheet title={`Brief for ${b.dayKey}`}>
        <dl className="kv">
          <dt>Money in today</dt>
          <dd className={cls}>{usd(b.moneyInTodayUsd)}</dd>
          <dt>Money out today</dt>
          <dd className={cls}>{usd(b.moneyOutTodayUsd)}</dd>
          <dt>Net today</dt>
          <dd className={cls}>{usd(b.netTodayUsd)}</dd>
          <dt>Net all time</dt>
          <dd className={cls}>{usd(b.netTotalUsd)}</dd>
        </dl>
        {b.simulated ? <div className="stamp-s">Simulated</div> : null}
      </Sheet>
      <Sheet title="Needs you">
        {b.needs.length === 0 ? <div className="muted">Nothing. Enjoy the view.</div> : null}
        <ul className="plain">
          {b.needs.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </Sheet>
      <Sheet title="One line per floor">
        <ul className="plain floors-list">
          {b.floors.map((f) => (
            <li key={f.slug}>
              <strong>{f.name}:</strong> {f.line}
            </li>
          ))}
        </ul>
      </Sheet>
      {b.notes.length ? (
        <Sheet title="Warden's last runs" clip>
          <ul className="plain">
            {warden.runs.map((r) => (
              <li key={r.id}>
                <span className="muted">{when(r.startedAt)}</span> {r.summary ?? r.status}
              </li>
            ))}
          </ul>
        </Sheet>
      ) : (
        <Sheet title="Warden's runs">
          <div className="muted">No runs yet today.</div>
        </Sheet>
      )}
    </>
  );
}

// Spend cap, budget level, spend by floor. Raising the hard ceiling is an approval item (Phase 4).
export function BudgetTab({ warden, onChanged }: { warden: WardenSummary | null; onChanged?: () => void }) {
  const [cap, setCap] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!warden) return <Empty>Counting the coins</Empty>;
  const b = warden.budget;
  const pct = b.dailyCapUsd > 0 ? Math.min(100, Math.round((b.spendTodayUsd / b.dailyCapUsd) * 100)) : 0;

  async function saveCap() {
    if (busy) return;
    const v = Number(cap);
    if (!Number.isFinite(v) || v <= 0) {
      setNote("Type a number in USD.");
      return;
    }
    setBusy(true);
    const res = await post("/api/settings", { key: "daily_cap_usd", value: v });
    setBusy(false);
    setNote(res.ok ? "Cap saved" : (res.error ?? "Could not save"));
    if (res.ok) {
      setCap("");
      onChanged?.();
    }
    setTimeout(() => setNote(""), 3000);
  }

  return (
    <>
      <Sheet title="Budget level">
        <div className="segments">
          {[1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={i <= b.level ? "on" : ""} />
          ))}
        </div>
        <div className="muted">Level {b.level}. Every 7 days: revenue at 2x spend raises it, below 1x for two weeks drops it.</div>
      </Sheet>
      <Sheet title="Daily cap">
        <div className="goal-line">
          <span className="goal-metric">Spent today</span>
          <span className="goal-num">
            {usd(b.spendTodayUsd)} of {usd(b.dailyCapUsd)}
          </span>
        </div>
        <div className="meter">
          <i style={{ width: `${pct}%`, background: pct >= 100 ? "#c94f7c" : pct >= 60 ? "#f08a24" : undefined }} />
        </div>
        <div className="muted">Workers slow to 40 percent at 60 percent of the cap. Floors pause at the cap. Hard ceiling {usd(b.hardCeilingUsd)}, raising it needs an approval.</div>
        <div className="paste-row">
          <input className="field" inputMode="decimal" placeholder={`New cap, up to ${b.hardCeilingUsd}`} value={cap} onChange={(e) => setCap(e.target.value)} />
          <Key small onClick={() => void saveCap()} disabled={busy}>
            Save
          </Key>
        </div>
        {note ? <span className="note-s">{note}</span> : null}
      </Sheet>
      <Sheet title="Today by floor">
        {b.todayByFloor.length === 0 ? <div className="muted">No spend yet today.</div> : null}
        <dl className="kv">
          {b.todayByFloor.map((f) => (
            <FloorSpend key={f.slug} name={f.name} usd={f.usd} simulated={warden.simulated} />
          ))}
        </dl>
      </Sheet>
      <Sheet title="Monthly guide">
        <dl className="kv">
          {Object.entries(b.allocationGuide).map(([k, v]) => (
            <FloorSpend key={k} name={k.replace(/_/g, " ")} usd={Number(v)} simulated={false} />
          ))}
        </dl>
        <div className="muted">A guide, not a wall. The daily cap is the wall.</div>
      </Sheet>
    </>
  );
}

function FloorSpend({ name, usd: n, simulated }: { name: string; usd: number; simulated: boolean }) {
  return (
    <>
      <dt style={{ textTransform: "capitalize" }}>{name}</dt>
      <dd className={simulated ? "sim" : ""}>{usd(n)}</dd>
    </>
  );
}

interface IdeaRow {
  id: string;
  text: string;
  source: string;
  status: string;
  wardenReply: string | null;
  createdAt: string;
}

// The mail slot: drop an idea, Warden turns it into a ticket on his next run.
export function IdeasTab() {
  const { data, error, reload } = usePoll<{ ideas: IdeaRow[] }>("/api/ideas", 8000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function drop() {
    if (busy) return;
    if (text.trim().length < 3) {
      setNote("Write the idea first.");
      return;
    }
    setBusy(true);
    const res = await post("/api/ideas", { text: text.trim() });
    setBusy(false);
    if (!res.ok) {
      setNote(res.error ?? "Could not post it");
      return;
    }
    setText("");
    setNote("In the slot. Warden reads it on his next run.");
    reload();
    setTimeout(() => setNote(""), 3000);
  }

  return (
    <>
      <Sheet title="Drop an idea in the slot">
        <textarea className="field" rows={3} placeholder="For example: try the Sharjah free zone forwarders too" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="actions">
          <Key onClick={() => void drop()} disabled={busy}>
            Post it
          </Key>
          {note ? <span className="note-s">{note}</span> : null}
        </div>
      </Sheet>
      {error && !data ? <Empty>{error}</Empty> : null}
      <Sheet title="Inbox">
        {(data?.ideas ?? []).length === 0 ? <div className="muted">Empty. Warden loves a full slot.</div> : null}
        <ul className="history">
          {(data?.ideas ?? []).map((i) => (
            <li key={i.id}>
              <div className="h-top">
                <span className="h-title">{i.text}</span>
                <Pill status={i.status} />
              </div>
              <div className="muted">
                {when(i.createdAt)} via {i.source}
              </div>
              {i.wardenReply ? <div className="reply">Warden: {i.wardenReply}</div> : null}
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}
