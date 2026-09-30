"use client";

import { useState } from "react";
import type { CompanyView } from "@/lib/company";
import { Empty, Key, Sheet, since, usePoll, usd, when } from "./shared";

const OWNER_LABEL: Record<string, string> = { scout: "Scout", analyst: "Analyst", writer: "Writer", chaser: "Chaser", partners: "Partners", product: "Product", marketer: "Marketer", success: "Success" };
const IDEA_STATE: Record<CompanyView["ideas"][number]["state"], string> = { waiting: "Waiting on you", running: "Running", ended: "Ended" };

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Key
      small
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </Key>
  );
}

// DocLedger as a startup: the founder's view of the company and the people building it.
export function CompanyTab({ onApprovals }: { onApprovals: () => void }) {
  const q = usePoll<{ company: CompanyView }>("/api/company", 20000);
  const c = q.data?.company;
  if (!c) return <Empty>{q.error ?? "Opening the books"}</Empty>;
  const n = c.numbers;
  const tiles: Array<[string, string]> = [
    ["Leads", String(n.leads)],
    ["Emails sent", String(n.emailsSent)],
    ["Replies", String(n.replies)],
    ["Demos", String(n.demos)],
    ["Partners", String(n.partners)],
    ["In free month", String(n.trials)],
    ["Customers", String(n.clients)],
    ["Monthly revenue", usd(n.mrrUsd)],
    ["AI spend", usd(n.spendUsd)],
  ];
  const waiting = c.ideas.filter((i) => i.state === "waiting");
  const pack = c.marketing;
  return (
    <>
      <Sheet title="The last 7 days">
        <div className="kpis">
          {tiles.map(([k, v]) => (
            <div key={k} className="kpi">
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
        <div className="muted">
          Cost per lead {n.costPerLeadUsd !== null ? usd(n.costPerLeadUsd) : "not yet"}, per reply {n.costPerReplyUsd !== null ? usd(n.costPerReplyUsd) : "not yet"}. Since the start: {n.allTime.leads} leads, {n.allTime.emailsSent} emails, {n.allTime.clients} customers.
        </div>
      </Sheet>

      {waiting.length ? (
        <Sheet title={`${waiting.length} idea${waiting.length === 1 ? "" : "s"} waiting on you`} className="alert-sheet">
          {waiting.map((i) => (
            <div key={i.id} className="idea-row">
              <b>{i.title}</b>
              <div className="muted">
                {OWNER_LABEL[i.owner] ?? i.owner}: {i.why}
              </div>
            </div>
          ))}
          <Key small tone="ok" onClick={onApprovals}>
            Open the red phone
          </Key>
        </Sheet>
      ) : null}

      <Sheet title="The team">
        {c.team.map((t) => (
          <div key={t.id} className={`team-row ${t.status}`}>
            <div className="h-top">
              <b>
                {t.name} <span className="muted">{t.role.toLowerCase() === t.name.toLowerCase() ? "" : `${t.role}, `}{t.floor} floor</span>
              </b>
              <span className="muted">{t.doneWeek} this week</span>
            </div>
            <div className="muted">{t.lastWork ? `${t.lastWork}${t.lastAt ? `, ${since(t.lastAt)}` : ""}` : "No finished work yet"}</div>
          </div>
        ))}
      </Sheet>

      <Sheet title="Experiments">
        {c.ideas.filter((i) => i.state !== "waiting").length === 0 ? <div className="muted">None running yet. Approve an idea from Growth to start one.</div> : null}
        {c.ideas
          .filter((i) => i.state !== "waiting")
          .map((i) => (
            <div key={i.id} className={`idea-row ${i.state}`}>
              <div className="h-top">
                <b>{i.title}</b>
                <span className="muted">{IDEA_STATE[i.state]}</span>
              </div>
              <div className="muted">
                {OWNER_LABEL[i.owner] ?? i.owner}
                {i.endsAt ? `, until ${when(i.endsAt)}` : ""}
              </div>
            </div>
          ))}
      </Sheet>

      <Sheet title="Roadmap from Product">
        {c.roadmap.length === 0 ? <div className="muted">Product writes it from what the market says, after the first replies.</div> : null}
        {c.roadmap.map((r) => (
          <div key={r.title} className={`road-row ${r.priority}`}>
            <div className="h-top">
              <b>{r.title}</b>
              <span className="road-pill">{r.priority}</span>
            </div>
            <div className="muted">{r.why}</div>
          </div>
        ))}
      </Sheet>

      <Sheet title="Marketer's pack, for you to post">
        {!pack ? <div className="muted">The first pack arrives within a day.</div> : null}
        {pack?.linkedin.map((p, i) => (
          <div key={i} className="post-card">
            <div className="h-top">
              <b>LinkedIn post {i + 1}</b>
              <Copy text={`${p.hook}\n\n${p.body}`} />
            </div>
            <pre>{`${p.hook}\n\n${p.body}`}</pre>
          </div>
        ))}
        {pack?.listing.tagline ? (
          <div className="post-card">
            <div className="h-top">
              <b>Directory listing</b>
              <Copy text={`${pack.listing.tagline}\n\n${pack.listing.description}\n\n${pack.listing.categories.join(", ")}`} />
            </div>
            <pre>{`${pack.listing.tagline}\n\n${pack.listing.description}\n\nCategories: ${pack.listing.categories.join(", ")}`}</pre>
          </div>
        ) : null}
        {pack?.page.headline ? (
          <div className="post-card">
            <div className="h-top">
              <b>Web page words</b>
              <Copy text={`${pack.page.headline}\n${pack.page.subheadline}\n\n${pack.page.points.join("\n")}\n\n${pack.page.cta}`} />
            </div>
            <pre>{`${pack.page.headline}\n${pack.page.subheadline}\n\n${pack.page.points.map((x) => `• ${x}`).join("\n")}\n\n${pack.page.cta}`}</pre>
          </div>
        ) : null}
      </Sheet>

      <Sheet title="Customers">
        {c.customers.length === 0 ? <div className="muted">None yet. When a company starts, send /trial followed by the company name on Telegram; when it pays, /won, the name and the monthly price.</div> : null}
        {c.customers.map((k) => (
          <div key={k.id} className={`team-row ${k.status}`}>
            <div className="h-top">
              <b>{k.company}</b>
              <span className="muted">{k.status === "client" ? `${usd(k.monthlyUsd ?? 0)} a month` : "Free month"}</span>
            </div>
            <div className="muted">
              {k.country}
              {k.since ? `, since ${when(k.since)}` : ""}
            </div>
          </div>
        ))}
      </Sheet>

      {c.report ? (
        <Sheet title={`Founder report, ${when(c.report.at)}`}>
          <pre className="report">{c.report.text}</pre>
        </Sheet>
      ) : null}
    </>
  );
}
