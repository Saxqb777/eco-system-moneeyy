"use client";

import { useState } from "react";
import type { MailMessage, MailThread, MailThreadDetail, ThreadState } from "@/lib/mailbox";
import { Empty, Key, Pill, Sheet, since, usePoll, when } from "./shared";

const STATE_LABEL: Record<ThreadState, string> = {
  hot: "Hot",
  waiting: "Waiting on you",
  replied: "They replied",
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

type Filter = "all" | "hot" | "waiting";

// The mail room: every company DocLedger is writing to, and each whole conversation in order.
export function MailboxTab({ onApprovals }: { onApprovals: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const list = usePoll<{ threads: MailThread[]; counts: { hot: number; waiting: number } }>(open ? null : `/api/mailbox?filter=${filter}`, 15000);
  if (open) return <ThreadView leadId={open} onBack={() => setOpen(null)} onApprovals={onApprovals} />;
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
