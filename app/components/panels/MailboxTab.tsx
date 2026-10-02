"use client";

import { useState } from "react";
import type { CallRow } from "@/lib/callsheet";
import type { MailMessage, MailThread, MailThreadDetail, ThreadState } from "@/lib/mailbox";
import { Empty, Key, Pill, Sheet, post, since, usePoll, when } from "./shared";

const STATE_LABEL: Record<ThreadState, string> = {
  hot: "Hot",
  waiting: "Waiting on you",
  replied: "They replied",
  visited: "Opened the demo",
  sent: "Sent",
  drafting: "Drafting",
  paused: "Paused",
  demo: "Demo booked",
  closed: "Closed",
};

const HOW_LABEL: Record<NonNullable<MailMessage["how"]>, string> = {
  auto: "Sent on its own",
  approved: "Approved by you",
  yours: "Written by you",
  waiting: "Waiting for your tap",
  rejected: "Rejected by you",
  replaced: "Replaced by your own answer",
  draft: "Draft",
};

type Filter = "all" | "hot" | "waiting" | "calls";

// The mail room: every company DocLedger is writing to, and each whole conversation in order.
export function MailboxTab({ onApprovals }: { onApprovals: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const list = usePoll<{ threads: MailThread[]; counts: { hot: number; waiting: number } }>(open || filter === "calls" ? null : `/api/mailbox?filter=${filter}`, 15000);
  if (open) return <ThreadView leadId={open} onBack={() => setOpen(null)} onApprovals={onApprovals} />;
  if (filter === "calls") return <CallSheetView onBack={() => setFilter("all")} />;
  const threads = list.data?.threads ?? [];
  const counts = list.data?.counts;
  return (
    <>
      <div className="mail-filters">
        <Key small tone={filter === "all" ? "ok" : "plain"} onClick={() => setFilter("all")}>
          All
        </Key>
        <Key small tone={filter === "hot" ? "ok" : "plain"} onClick={() => setFilter("hot")}>
          Hot{counts?.hot ? ` ${counts.hot}` : ""}
        </Key>
        <Key small tone={filter === "waiting" ? "ok" : "plain"} onClick={() => setFilter("waiting")}>
          Waiting on you{counts?.waiting ? ` ${counts.waiting}` : ""}
        </Key>
        <Key small tone="plain" onClick={() => setFilter("calls")}>
          Call sheet
        </Key>
      </div>
      {list.error && !list.data ? <Empty>{list.error}</Empty> : null}
      {!list.data && !list.error ? <Empty>Sorting the post</Empty> : null}
      {list.data && threads.length === 0 ? (
        <Sheet title={filter === "all" ? "No letters yet" : "Nothing here"}>
          <div className="muted">{filter === "all" ? "The first emails show up here as soon as the Writer drafts them." : "No thread needs you right now."}</div>
        </Sheet>
      ) : null}
      {threads.map((t) => (
        <button key={t.leadId} type="button" className={`thread-row ${t.state}`} onClick={() => setOpen(t.leadId)}>
          <div className="h-top">
            <span className="h-title">
              {t.company}
              {t.country ? <span className="cc">{t.country}</span> : null}
            </span>
            <Pill status={t.state}>{STATE_LABEL[t.state]}</Pill>
          </div>
          <div className="muted">
            {t.contact ?? "No contact yet"}, {since(t.lastAt)}, {t.messages} message{t.messages === 1 ? "" : "s"}
          </div>
          {t.lastLine ? (
            <div className="thread-last">
              <b>{t.lastFrom === "us" ? "Us: " : "Them: "}</b>
              {t.lastLine}
            </div>
          ) : null}
        </button>
      ))}
    </>
  );
}

function ThreadView({ leadId, onBack, onApprovals }: { leadId: string; onBack: () => void; onApprovals: () => void }) {
  const q = usePoll<{ thread: MailThreadDetail }>(`/api/mailbox?lead=${encodeURIComponent(leadId)}`, 15000);
  const t = q.data?.thread;
  return (
    <>
      <div className="actions">
        <Key small tone="plain" onClick={onBack}>
          All threads
        </Key>
      </div>
      {q.error && !t ? <Empty>{q.error}</Empty> : null}
      {!t && !q.error ? <Empty>Opening the folder</Empty> : null}
      {t ? (
        <>
          <Sheet clip className={`thread-head ${t.state}`}>
            <div className="h-top">
              <span className="h-title">{t.company}</span>
              <Pill status={t.state}>{STATE_LABEL[t.state]}</Pill>
            </div>
            <div className="muted">
              {[t.contact, t.title].filter(Boolean).join(", ") || "No contact yet"}
              {t.email ? `, ${t.email}` : ""}
            </div>
            <div className="muted">{[t.city, t.country].filter(Boolean).join(", ")}</div>
            {t.previewUrl ? (
              <div className="muted">
                Their preview page:{" "}
                <a className="linkish" href={t.previewUrl} target="_blank" rel="noreferrer">
                  open it
                </a>
              </div>
            ) : null}
          </Sheet>
          {t.items.length === 0 ? <Empty>Nothing written yet.</Empty> : null}
          {t.items.map((m) => (
            <Letter key={m.id} m={m} contact={t.contact ?? t.company} onApprovals={onApprovals} />
          ))}
        </>
      ) : null}
    </>
  );
}

function Letter({ m, contact, onApprovals }: { m: MailMessage; contact: string; onApprovals: () => void }) {
  return (
    <section className={`letter ${m.from}`}>
      <div className="letter-head">
        <span className="letter-from">{m.from === "us" ? "From DocLedger" : `From ${contact}`}</span>
        <span className="muted">{when(m.at)}</span>
      </div>
      {m.subject ? <div className="letter-subject">{m.subject}</div> : null}
      <pre>{m.body}</pre>
      {m.how ? (
        <div className={`how ${m.how}`}>
          {HOW_LABEL[m.how]}
          {m.how === "waiting" ? (
            <Key small tone="ok" onClick={onApprovals}>
              Open the red phone
            </Key>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// D079: today's five companies worth a phone call or a WhatsApp from the owner, with the opening line ready.
const OUTCOME_LABEL: Record<string, string> = { interested: "Interested", no_answer: "No answer", not_now: "Not now", no: "No" };

function CallSheetView({ onBack }: { onBack: () => void }) {
  const q = usePoll<{ dayKey: string; rows: CallRow[] }>("/api/mailbox?filter=calls", 30000);
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  async function mark(leadId: string, outcome: string) {
    setBusy(leadId);
    const res = await post("/api/mailbox", { action: "called", leadId, outcome });
    setBusy(null);
    setNote(res.ok ? String(res.message ?? "Noted.") : (res.error ?? "Could not save that"));
    q.reload();
    setTimeout(() => setNote(""), 5000);
  }
  const wa = (phone: string) => `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
  return (
    <>
      <div className="mail-filters">
        <Key small tone="plain" onClick={onBack}>
          Back to the letters
        </Key>
        {note ? <span className="muted">{note}</span> : null}
      </div>
      <Sheet title="Call sheet" clip>
        <div className="muted">Twenty minutes a day. The ones that opened their demo first, then good fits with no public email, then the quiet ones. Mark each call and the Chaser writes the email after it.</div>
      </Sheet>
      {q.error && !q.data ? <Empty>{q.error}</Empty> : null}
      {q.data && rows.length === 0 ? (
        <Sheet title="Nobody to call today">
          <div className="muted">No home market company with a phone number is waiting. The Scout brings more tomorrow.</div>
        </Sheet>
      ) : null}
      {rows.map((r, i) => (
        <Sheet key={r.leadId} title={`${i + 1}. ${r.company}`} className="call-row">
          <div className="h-top">
            <b>{[r.contact, r.title].filter(Boolean).join(", ") || "Whoever runs the month end"}</b>
            <span className="muted">{[r.city, r.country].filter(Boolean).join(", ")}</span>
          </div>
          <div className="muted">
            Why: {r.why}. {r.bill ? `Talk about: ${r.bill}.` : ""} {r.attempts ? `${r.attempts} tr${r.attempts === 1 ? "y" : "ies"} so far${r.lastOutcome ? `, last ${OUTCOME_LABEL[r.lastOutcome]?.toLowerCase()}` : ""}.` : ""}
          </div>
          <div className="row-keys">
            <a className="key small" href={`tel:${r.phone}`}>
              Call {r.phone}
            </a>
            <a className="key small" href={wa(r.phone)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            {r.demoUrl ? (
              <a className="key small" href={r.demoUrl} target="_blank" rel="noreferrer">
                Their demo
              </a>
            ) : null}
          </div>
          <pre>{r.opening}</pre>
          <div className="row-keys">
            {Object.entries(OUTCOME_LABEL).map(([k, label]) => (
              <Key key={k} small tone={k === "interested" ? "ok" : k === "no" ? "bad" : "plain"} disabled={busy === r.leadId} onClick={() => void mark(r.leadId, k)}>
                {label}
              </Key>
            ))}
          </div>
        </Sheet>
      ))}
    </>
  );
}
