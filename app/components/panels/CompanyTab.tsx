"use client";

import { useState } from "react";
import type { CompanyView } from "@/lib/company";
import { Empty, Key, Sheet, post, since, usePoll, usd, when } from "./shared";

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
          The funnel: found {n.leads}, with an address {n.emailable}, sent {n.emailsSent}, delivered {n.delivered}, bounced {n.bounced}, opened their demo {n.demoOpens}, replied {n.replies}, demos booked {n.demos}, free month {n.trials}, paying {n.clients}.
        </div>
        <div className="muted">
          Cost per stage: lead {n.costPerLeadUsd !== null ? usd(n.costPerLeadUsd) : "not yet"}, email {n.costPerEmailUsd !== null ? usd(n.costPerEmailUsd) : "not yet"}, demo opened {n.costPerDemoOpenUsd !== null ? usd(n.costPerDemoOpenUsd) : "not yet"}, reply {n.costPerReplyUsd !== null ? usd(n.costPerReplyUsd) : "not yet"}. Since the start: {n.allTime.leads} leads, {n.allTime.emailsSent} emails, {n.allTime.clients} customers.
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

      <SocialSheet social={c.social} onChanged={q.reload} />

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
              {k.trialEndsAt && k.status === "trial" ? `, free month ends ${when(k.trialEndsAt)}` : ""}
            </div>
            {k.usage ? <div className="muted">{k.usage}</div> : null}
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

const PLAN_STATE: Record<string, string> = { planned: "Planned", drafting: "Writing", drafted: "Written", skipped: "Skipped" };
const POST_STATE: Record<string, string> = { draft: "Waiting on you", approved: "Approved, posts at the next hour", posted: "Posted", rejected: "Turned down" };

// Social runs the DocLedger Facebook Page (D074): the week's plan, the latest posts with their numbers, and the
// auto posting switch once the owner has turned it on.
function SocialSheet({ social: s, onChanged }: { social: CompanyView["social"]; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle(on: boolean) {
    if (busy) return;
    setBusy(true);
    await post("/api/company", { action: "auto_post", on });
    setBusy(false);
    onChanged?.();
  }
  const w = s.week;
  return (
    <Sheet title="Social, the DocLedger Facebook Page">
      {!s.connected ? <div className="muted">Not connected yet. Paste the Page ID and token in the Setup tab (DocLedger Facebook Page). Social already plans the week, and starts writing posts the moment the Page is connected.</div> : null}
      {s.connected ? (
        <div className="kpis">
          <div className="kpi"><b>{s.followers ?? "?"}</b><span>Followers</span></div>
          <div className="kpi"><b>{w.posts}</b><span>Posts this week</span></div>
          <div className="kpi"><b>{w.views}</b><span>Views</span></div>
          <div className="kpi"><b>{w.reactions}</b><span>Reactions</span></div>
          <div className="kpi"><b>{w.comments}</b><span>Comments</span></div>
          <div className="kpi"><b>{w.shares}</b><span>Shares</span></div>
        </div>
      ) : null}
      <div className="h-top">
        <span className="muted">
          {s.autoPost ? `Auto posting is on, at most ${s.postsPerDay} a day.` : `Every post waits on your tap. After 10 approved in a row (${s.trustApprovedInARow} so far), the Tower asks to switch on auto posting.`}
        </span>
        {s.autoPost ? (
          <Key small onClick={() => void toggle(false)} disabled={busy}>
            Turn off
          </Key>
        ) : null}
      </div>
      {s.plan ? (
        <div className="post-card">
          <b>This week&apos;s plan, from {when(s.plan.at)}</b>
          {s.plan.items.map((i, k) => (
            <div key={k} className="muted">
              Day {i.day + 1}, {i.theme}: {i.idea} <em>({PLAN_STATE[i.status] ?? i.status})</em>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted">The first plan comes on the next heartbeat after 08:00 Dubai.</div>
      )}
      {s.recent.map((p) => (
        <div key={p.id} className="post-card">
          <div className="h-top">
            <b>{POST_STATE[p.status] ?? p.status}</b>
            <span className="muted">{p.postedAt ? since(p.postedAt) : ""}</span>
          </div>
          <pre>{p.text}</pre>
          {p.stats ? (
            <div className="muted">
              {p.stats.reactions} reactions, {p.stats.comments} comments, {p.stats.shares} shares{p.stats.views !== null ? `, ${p.stats.views} views` : ""}
            </div>
          ) : null}
        </div>
      ))}
    </Sheet>
  );
}
