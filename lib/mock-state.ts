// Fixture state for local screenshots and tests. Never used on Vercel: only when TOWER_MOCK_STATE is 1.
import { AGENTS, FLOORS, SETUP_ITEMS } from "@/config/tower";
import type { MailMessage, MailThread, MailThreadDetail } from "@/lib/mailbox";
import type { TowerState } from "@/lib/state";
import type { AgentDetail, FloorDetail, WardenSummary } from "@/lib/detail";
import type { TradingDetail, TradingStateView } from "@/trading/view";

export function mockState(now = new Date()): TowerState {
  const floors = FLOORS.filter((f) => f.status !== "archived").map((f) => ({
    id: `floor_${f.slug}`,
    slug: f.slug,
    name: f.name,
    level: f.level,
    accent: f.accent,
    status: f.status,
    goalMetric: f.goalMetric,
    weeklyTarget: f.weeklyTarget,
    targetUnit: f.targetUnit,
    unlockRule: f.unlockRule,
    strategyNote: f.slug === "docledger" ? "Jebel Ali forwarders answer faster. Scout shifts there this week." : null,
    pausedReason: null,
    throttled: false,
    behindTarget: f.slug === "docledger",
    missingSetup: [] as string[],
    isBusiness: f.isBusiness,
    ...(f.slug === "growth" ? { board: ["Leads 11", "Emails 4", "Replies 1", "Partners 2", "In trial 0", "Customers 0"] } : {}),
    agents: AGENTS.filter((a) => a.floorSlug === f.slug).map((a, i) => {
      const status = a.kind === "warden" ? "idle" : a.slug === "docledger_chaser" ? "blocked" : a.slug === "growth_finance" || a.slug === "trading_larry" ? "idle" : a.floorSlug === "trading" ? "working" : i % 2 === 0 ? "working" : "idle";
      const titles: Record<string, string> = {
        docledger_scout: "Find freight forwarders",
        docledger_writer: "Draft outreach email",
        docledger_builder: "Fix invoice export",
        growth_lead: "Pitch three ideas",
        growth_partners: "Find accounting partners",
        growth_product: "Update the roadmap",
        growth_marketer: "Write LinkedIn post",
        growth_success: "Welcome a trial",
        growth_finance: "Count the funnel",
        growth_social: "Facebook post: demo invite",
      };
      return {
        id: `agent_${a.slug}`,
        slug: a.slug,
        name: a.name,
        role: a.role,
        kind: a.kind,
        status,
        locationLevel: f.level,
        sprite: a.sprite,
        currentTask: status === "idle" || a.floorSlug === "trading" ? null : { id: `task_${a.slug}`, title: titles[a.slug] ?? "Chase warm reply", kind: "x", status: status === "blocked" ? "blocked" : "running", startedAt: now.toISOString(), dueAt: null, blockedReason: status === "blocked" ? "Need the calendar link to book the demo" : null },
        stats: { tasksDone: 12 + i * 3, tasksFailed: 1, successRate: 92, avgReviewScore: 8.1 },
        waitingOnOwner: a.slug === "growth_lead" ? 2 : 0,
      };
    }),
  }));
  return {
    now: now.toISOString(),
    dubai: { dayKey: "2026-09-30", hour: 0, minute: 30, night: true },
    simulationMode: true,
    budget: { level: 1, dailyCapUsd: 1.7, hardCeilingUsd: 5 },
    money: {
      real: { netUsd: 0, spendTodayUsd: 0, verifiedRevenueUsd: 0, totalSpendUsd: 0 },
      simulated: { netUsd: 38.2, spendTodayUsd: 0.93, verifiedRevenueUsd: 52.4, totalSpendUsd: 14.2 },
    },
    floors,
    pendingApprovals: 3,
    recentEvents: [],
    lastTicks: [],
    setup: SETUP_ITEMS.map((s) => ({ key: s.key, label: s.label, status: "missing", hint: null, requiredFor: s.requiredFor })),
    trading: mockTradingState(now),
  };
}

export function mockEnabled(): boolean {
  return process.env.TOWER_MOCK_STATE === "1" && process.env.VERCEL !== "1";
}

// Panel fixtures for the same screenshot mode.
function ago(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60000).toISOString();
}

export function mockAgentDetail(id: string, now = new Date()): AgentDetail | null {
  const state = mockState(now);
  for (const f of state.floors) {
    const a = f.agents.find((x) => x.id === id || x.slug === id);
    if (!a) continue;
    const warden = a.kind === "warden";
    const title = a.currentTask?.title ?? "Chase warm reply";
    return {
      id: a.id,
      slug: a.slug,
      name: a.name,
      role: a.role,
      kind: a.kind,
      status: a.status,
      modelKey: warden ? "warden" : a.kind,
      sprite: a.sprite,
      floor: { slug: f.slug, name: f.name, level: f.level, accent: f.accent },
      currentTask: a.currentTask ? { ...a.currentTask, feedback: null } : null,
      log: warden
        ? [
            { id: 1, type: "log", message: "Warden run: Reviewed the queue, reassigned two stale tasks, spend is inside the cap.", taskId: null, createdAt: ago(now, 240) },
            { id: 2, type: "warden_dispatched", message: "Warden is riding the lift to DocLedger Sales", taskId: null, createdAt: ago(now, 52) },
            { id: 3, type: "warden_arrived", message: "Warden unblocked Chaser: Need the calendar link to book the demo", taskId: null, createdAt: ago(now, 50) },
            { id: 4, type: "log", message: "Warden went back up to the Penthouse", taskId: null, createdAt: ago(now, 48) },
          ]
        : [
            { id: 1, type: "output", message: "Found 4 new leads", taskId: "t0", createdAt: ago(now, 95) },
            { id: 2, type: "review", message: "Warden scored 8/10: Meets the playbook, accepted", taskId: "t0", createdAt: ago(now, 94) },
            { id: 3, type: "done", message: "Find freight forwarders done", taskId: "t0", createdAt: ago(now, 94) },
            { id: 4, type: "created", message: `${title} queued`, taskId: "t1", createdAt: ago(now, 31) },
            { id: 5, type: "started", message: `${a.name} started: ${title}`, taskId: "t1", createdAt: ago(now, 30) },
            ...(a.status === "blocked"
              ? [
                  { id: 6, type: "blocked", message: `${a.name} is blocked: Need the calendar link to book the demo`, taskId: "t1", createdAt: ago(now, 12) },
                  { id: 7, type: "help_requested", message: `${a.name} raised a hand`, taskId: "t1", createdAt: ago(now, 12) },
                ]
              : []),
          ],
      history: warden
        ? []
        : [
            { id: "t1", title, kind: "x", status: a.status === "blocked" ? "blocked" : a.status === "working" ? "running" : "queued", startedAt: ago(now, 30), finishedAt: null, reviewScore: null, reviewReason: null, summary: a.status === "blocked" ? "Blocked: Need the calendar link to book the demo" : a.status === "working" ? "In progress" : "Waiting in the queue" },
            { id: "t0", title: "Find freight forwarders", kind: "find_leads", status: "done", startedAt: ago(now, 110), finishedAt: ago(now, 94), reviewScore: 8, reviewReason: "Meets the playbook, accepted", summary: "Found 4 new leads" },
            { id: "t9", title: "Scan customs brokers", kind: "find_leads", status: "rejected", startedAt: ago(now, 300), finishedAt: ago(now, 280), reviewScore: 4, reviewReason: "Too generic, no reference to the lead's own business", summary: "Draft output ready for review" },
            { id: "t8", title: "List small 3PLs", kind: "find_leads", status: "done", startedAt: ago(now, 520), finishedAt: ago(now, 500), reviewScore: 9, reviewReason: "Meets the playbook, accepted", summary: "Found 5 new leads" },
          ],
      today: warden ? { runs: 2, inputTokens: 17400, outputTokens: 2100, cacheReadTokens: 0, webSearches: 0, costUsd: 0.11 } : { runs: 3, inputTokens: 31200, outputTokens: 4100, cacheReadTokens: 9800, webSearches: 5, costUsd: 0.07 },
      stats: a.stats,
      simulated: true,
    };
  }
  return null;
}

export function mockFloorDetail(slug: string, now = new Date()): FloorDetail | null {
  const state = mockState(now);
  const f = state.floors.find((x) => x.slug === slug);
  if (!f) return null;
  const active = f.agents
    .filter((a) => a.currentTask)
    .map((a) => ({ id: a.currentTask!.id, title: a.currentTask!.title, agentName: a.name, status: a.currentTask!.status, startedAt: a.currentTask!.startedAt, dueAt: null, blockedReason: a.currentTask!.blockedReason }));
  const live = f.status === "live" && f.isBusiness;
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    level: f.level,
    accent: f.accent,
    status: f.status,
    goalMetric: f.goalMetric,
    weeklyTarget: f.weeklyTarget,
    targetUnit: f.targetUnit,
    weeklyActual: 0,
    measure: f.slug === "growth" ? "Paying customers this week" : f.slug === "docledger" ? "Demos booked this week" : f.goalMetric,
    unlockRule: f.unlockRule,
    strategyNote: f.strategyNote,
    strategyUpdatedAt: f.strategyNote ? ago(now, 600) : null,
    pausedReason: null,
    throttledUntil: null,
    niche: f.slug === "docledger" ? "freight forwarders" : f.slug === "growth" ? "growth, partners, product, marketing" : null,
    monthlyGuideUsd: live ? 9 : 0,
    autoApprove: false,
    isBusiness: f.isBusiness,
    missingSetup: f.missingSetup.map((k) => ({ key: k, label: SETUP_ITEMS.find((s) => s.key === k)?.label ?? k })),
    agents: f.agents.map((a) => ({ id: a.id, slug: a.slug, name: a.name, role: a.role, status: a.status })),
    activeTasks: active,
    blockers: active.filter((t) => t.status === "blocked").map((t) => ({ taskId: t.id, title: t.title, agentName: t.agentName, reason: t.blockedReason ?? "", since: ago(now, 12) })),
    queued: live ? 2 : 0,
    doneThisWeek: f.slug === "docledger" ? 23 : f.slug === "growth" ? 17 : 0,
    money: {
      revenueWeekUsd: f.slug === "docledger" ? 99 : 0,
      revenueTotalUsd: f.slug === "docledger" ? 99 : 0,
      spendWeekUsd: f.slug === "docledger" ? 2.1 : f.slug === "growth" ? 1.4 : 0,
      spendTodayUsd: f.slug === "docledger" ? 0.55 : f.slug === "growth" ? 0.38 : 0,
    },
    simulated: true,
  };
}

export function mockWardenSummary(now = new Date()): WardenSummary {
  return {
    brief: {
      dayKey: "2026-09-30",
      simulated: true,
      moneyInTodayUsd: 12.4,
      moneyOutTodayUsd: 0.93,
      netTodayUsd: 11.47,
      netTotalUsd: 38.2,
      needs: [
        "3 approvals waiting on the red phone",
        "Chaser on DocLedger Sales is blocked: Need the calendar link to book the demo",
        "2 ideas from Growth wait on the red phone",
        "Anthropic API key: the building stays in simulation until it is on the clipboard",
      ],
      floors: [
        { slug: "penthouse", name: "Penthouse", level: 5, line: "Warden at the desk, last run Reviewed the queue, reassigned two stale tasks, spend is inside the cap." },
        { slug: "docledger", name: "DocLedger Sales", level: 4, line: "4 done today, 2 at work, 1 blocked, spent 0.55 USD, note: Jebel Ali forwarders answer faster. Scout shifts there this week." },
        { slug: "growth", name: "DocLedger Growth", level: 3, line: "7 done today, 2 at work, spent 0.38 USD" },
        { slug: "content", name: "Content Studio", level: 2, line: "Unlocks when tower net earnings pass 100 USD and budget level is 2 or higher" },
        { slug: "service", name: "Consulting Desk", level: 1, line: "Unlocks after the first DocLedger demo is booked and budget level is 2 or higher" },
        { slug: "lobby", name: "Lobby", level: 0, line: "Petty cash 38.20 USD in the drawer" },
      ],
      notes: ["Reviewed the queue, reassigned two stale tasks, spend is inside the cap.", "One worker raised a hand. Went down, unblocked it, back in the office."],
      team: ["Scout: 1 done, last: Found 6 new leads", "Analyst: 5 done, last: Scored PSZ Logistics: 8/10, email found", "Growth: 1 done, last: Brought 2 ideas to the founder", "Partners: 1 done, last: Found 2 partners, emails on the phone"],
    },
    budget: {
      level: 1,
      dailyCapUsd: 1.7,
      hardCeilingUsd: 5,
      spendTodayUsd: 0.93,
      todayByFloor: [{ slug: "docledger", name: "DocLedger Sales", usd: 0.55 }, { slug: "growth", name: "DocLedger Growth", usd: 0.38 }],
      allocationGuide: { warden: 6, growth: 9, docledger: 9, builder: 12, web_search: 9, buffer: 5 },
    },
    runs: [
      { id: "r1", mode: "batch", trigger: "schedule", status: "applied", summary: "Reviewed the queue, reassigned two stale tasks, spend is inside the cap.", costUsd: 0.06, startedAt: ago(now, 240) },
      { id: "r2", mode: "batch", trigger: "schedule", status: "applied", summary: "One worker raised a hand. Went down, unblocked it, back in the office.", costUsd: 0.05, startedAt: ago(now, 480) },
    ],
    pendingApprovals: 3,
    missingSetup: SETUP_ITEMS.filter((s) => s.key !== "docledger_repo_url").map((s) => ({ key: s.key, label: s.label, requiredFor: s.requiredFor })),
    simulated: true,
  };
}

export function mockApprovals(status: string, now = new Date()) {
  if (status !== "pending") return [];
  return [
    {
      id: "ap1", type: "outreach_email", status: "pending",
      summary: "Send first outreach email to Farah Haddad at Gulf Bridge Logistics",
      content: { to: "Gulf Bridge Logistics", subject: "Customs paperwork delays at Jebel Ali", body: "Hi Farah,\n\nSaw that Gulf Bridge moves a lot of LCL through Jebel Ali. Forwarders there lose about two hours a week chasing customs documents.\n\nDocLedger pulls every document into one ledger so the whole team sees what is missing. A short demo takes 15 minutes.\n\nIf that is not useful, reply stop and I will not write again.\n\nSaaqib" },
      previewUrl: null, riskNote: "Cold email to a business address. One plain opt out line included.", feedback: null,
      taskId: "t3", agentId: "agent_docledger_writer", floorId: "floor_docledger", simulated: true, createdAt: ago(now, 40), decidedAt: null, decidedVia: null,
    },
    {
      id: "ap2", type: "pull_request", status: "pending",
      summary: "Merge pull request: Fix invoice export",
      content: { title: "Fix invoice export", branch: "tower/fix-invoice-export", tests: "12 passed", filesChanged: 4 },
      previewUrl: "https://docledger-git-tower-fix-invoice-export.vercel.app", riskNote: "Code change on the DocLedger repo. Preview deployment attached.", feedback: null,
      taskId: "t4", agentId: "agent_docledger_builder", floorId: "floor_docledger", simulated: true, createdAt: ago(now, 130), decidedAt: null, decidedVia: null,
    },
    {
      id: "ap3", type: "decision", status: "pending",
      summary: "Idea: Partner with bookkeeping firms that serve Jebel Ali forwarders",
      content: { growthIdea: { title: "Partner with bookkeeping firms that serve Jebel Ali forwarders", why: "Three replies said their accountant keys the bills.", experiment: "Partners writes to ten bookkeeping firms in Dubai.", metric: "partner calls booked", owner: "partners", instructions: "Focus on bookkeeping firms with logistics clients in Dubai.", days: 14 }, text: "Three replies said their accountant keys the bills.\nThe test: Partners writes to ten bookkeeping firms in Dubai.\nWe measure: partner calls booked\nCarried by Partners for 14 days." },
      previewUrl: null, riskNote: "Approve to hand it to Partners for 14 days. Anything it sends still comes to you first.", feedback: null,
      taskId: null, agentId: "agent_growth_lead", floorId: "floor_growth", simulated: true, createdAt: ago(now, 15), decidedAt: null, decidedVia: null,
    },
  ];
}

export function mockIdeas(now = new Date()) {
  return [
    { id: "i2", text: "Offer to set up their first document type for them", source: "telegram", status: "new", floorId: null, ticketId: null, wardenReply: null, handledAt: null, createdAt: ago(now, 60) },
    { id: "i1", text: "Try the Sharjah free zone forwarders too", source: "ui", status: "ticketed", floorId: "floor_docledger", ticketId: null, wardenReply: "Added to Scout's list for next week.", handledAt: ago(now, 700), createdAt: ago(now, 720) },
  ];
}

export function mockSetup(now = new Date()) {
  return SETUP_ITEMS.map((s) => ({
    key: s.key, label: s.label, howTo: s.howTo, kind: s.kind, requiredFor: s.requiredFor,
    status: s.key === "docledger_repo_url" ? "present" : "missing",
    hint: s.key === "docledger_repo_url" ? "https://github.com/Saxqb777/docledger" : null,
    providedAt: s.key === "docledger_repo_url" ? ago(now, 900) : null,
  }));
}

// Mailbox fixtures for the local visual check: one thread in each state that matters.
export function mockMailbox(now = new Date()): { threads: MailThread[]; details: Record<string, MailThreadDetail> } {
  const ago = (h: number) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
  const msg = (id: string, from: "us" | "them", step: number, h: number, body: string, how: MailMessage["how"], subject: string | null = null, status = "sent"): MailMessage => ({ id, from, step, subject, body, at: ago(h), how, status: from === "them" ? "reply" : status, approvalId: null, previewUrl: null });
  const detail = (d: Omit<MailThreadDetail, "lastAt" | "lastLine" | "lastFrom" | "messages">): MailThreadDetail => {
    const last = d.items.at(-1)!;
    const line = (last.from === "us" && last.subject ? `${last.subject}: ${last.body}` : last.body).replace(/\s+/g, " ");
    return { ...d, lastAt: last.at, lastLine: line.length > 110 ? `${line.slice(0, 107)}...` : line, lastFrom: last.from, messages: d.items.length };
  };
  const list: MailThreadDetail[] = [
    detail({
      leadId: "mock-thames", company: "Thames Freight Ltd", contact: "Olivia Grant", email: "olivia@thamesfreight.example", country: "GB", city: "Felixstowe", state: "hot", title: "Finance Manager", leadStatus: "replied", previewUrl: "/for/mock01",
      items: [
        msg("t1", "us", 1, 50, "Hi Olivia,\nMost finance teams end the month the same way: an envelope of receipts and someone retyping them. At Felixstowe that is forty shipping line bills a month, every charge line keyed by hand.\nWorth fifteen minutes?\nSaaqib Khan, Founder, DocLedger", "auto", "Forty shipping bills, none retyped"),
        msg("t2", "them", 1, 20, "This looks useful. Could we see it next week? And what would it cost for three people in finance?", null),
        msg("t3", "us", 2, 19, "Happy to show you. Pick any 15 minutes here: cal.com/saaqib/15min. The first month is free, and after that plans start at 99 USD a month for the company, shaped around your own documents.", "waiting", "Re: Forty shipping bills, none retyped", "draft"),
      ],
    }),
    detail({
      leadId: "mock-gulf", company: "Gulf Crescent Freight", contact: "Farah Haddad", email: "farah@gulfcrescent.example", country: "AE", city: "Jebel Ali", state: "waiting", title: "Operations Manager", leadStatus: "drafted", previewUrl: "/for/mock02",
      items: [msg("g1", "us", 1, 2, "Hi Farah,\nYour month end at Jebel Ali ends with a pile of Maersk bills and someone retyping every container number.\nWorth fifteen minutes?", "waiting", "Customs documents at Jebel Ali", "draft")],
    }),
    detail({
      leadId: "mock-harbour", company: "Harbour Link Pty", contact: "Sam Kelly", email: "sam@harbourlink.example", country: "AU", city: "Sydney", state: "sent", title: "Accounts Manager", leadStatus: "contacted", previewUrl: null,
      items: [
        msg("h1", "us", 1, 120, "Hi Sam,\nFuel receipts with litres, odometer and plate, typed one by one at month end.\nWorth fifteen minutes?", "approved", "Fuel receipts, without the typing"),
        msg("h2", "us", 2, 30, "Hi Sam, one more thing: the same receipt submitted twice is rejected before it reaches the books.\nReply stop and I will not write again.", "auto", "Duplicates, caught at the door"),
      ],
    }),
    detail({
      leadId: "mock-desert", company: "Desert Link Shipping", contact: "Ali Rahman", email: "ali@desertlink.example", country: "AE", city: "Sharjah", state: "paused", title: "Finance Manager", leadStatus: "replied", previewUrl: null,
      items: [
        msg("d1", "us", 1, 200, "Hi Ali,\nShipping bills are the worst part of month end.\nWorth fifteen minutes?", "auto", "Your shipping bills"),
        msg("d2", "them", 1, 150, "It is our busy season, try me in a month.", null),
        msg("d3", "us", 2, 149, "Understood, good luck with the season. I will check back in a month.", "auto", "Re: Your shipping bills"),
      ],
    }),
    detail({
      leadId: "mock-marina", company: "Marina Cargo", contact: "Zed Ali", email: "zed@marinacargo.example", country: "AE", city: "Dubai", state: "closed", title: "Owner", leadStatus: "lost", previewUrl: null,
      items: [
        msg("m1", "us", 1, 300, "Hi Zed,\nPetty cash, without the retyping.\nWorth fifteen minutes?", "auto", "Your petty cash"),
        msg("m2", "them", 1, 280, "Please remove me from your list.", null),
      ],
    }),
  ];
  return { threads: list.map(({ title: _t, leadStatus: _l, previewUrl: _p, items: _i, ...t }) => t), details: Object.fromEntries(list.map((d) => [d.leadId, d])) };
}

export function mockCompany(now = new Date()): import("@/lib/company").CompanyView {
  const team = AGENTS.filter((a) => a.floorSlug === "docledger" || a.floorSlug === "growth").map((a, i) => ({
    id: `agent_${a.slug}`,
    name: a.name,
    role: a.role,
    floor: (a.floorSlug === "growth" ? "Growth" : "Sales") as "Sales" | "Growth",
    status: i % 3 === 0 ? "working" : "idle",
    lastWork: ({ docledger_scout: "Found 6 new leads", docledger_analyst: "Scored PSZ Logistics: 8/10, email found", docledger_writer: "Drafted the email to LBX Logistics", docledger_chaser: "Nothing to chase yet", docledger_builder: "Waiting for a ticket", growth_lead: "Brought 2 ideas to the founder", growth_partners: "Found 2 partners, emails on the phone", growth_product: "Roadmap updated (3 items), one ticket on the phone", growth_marketer: "Wrote 2 LinkedIn posts, a listing and page copy", growth_success: "No company in a free month yet", growth_finance: "Numbers: 11 leads, 4 emails, 1 replies this week, 1.28 USD spent" } as Record<string, string>)[a.slug] ?? null,
    lastAt: ago(now, 30 + i * 20),
    doneWeek: 3 + i,
  }));
  return {
    numbers: { from: ago(now, 7 * 1440), to: now.toISOString(), leads: 11, partners: 2, emailsSent: 4, delivered: 3, bounced: 0, demoOpens: 2, replies: 1, demos: 0, trials: 0, clients: 0, mrrUsd: 0, revenueUsd: 0, spendUsd: 3.42, costPerLeadUsd: 0.31, costPerReplyUsd: 3.42, allTime: { leads: 11, emailsSent: 4, replies: 1, clients: 0, revenueUsd: 0, spendUsd: 3.42 } },
    team,
    ideas: [
      { id: "ap3", title: "Partner with bookkeeping firms that serve Jebel Ali forwarders", owner: "partners", state: "waiting", why: "Three replies said their accountant keys the bills.", endsAt: null },
      { id: "x1", title: "Name the port in the subject line", owner: "writer", state: "running", why: "Local detail gets opened.", endsAt: new Date(now.getTime() + 9 * 86400000).toISOString() },
    ],
    roadmap: [
      { title: "Read PDF bills from shipping lines", why: "Asked for twice this week", evidence: "Two forwarders asked whether PDFs work", priority: "now" },
      { title: "Arabic receipts", why: "Gulf distributors keep Arabic fuel slips", evidence: "One reply mentioned Arabic slips", priority: "next" },
      { title: "Export to Zoho Books", why: "Partners resell Zoho", evidence: "Ledger Lane Accounting uses Zoho", priority: "later" },
    ],
    marketing: {
      at: ago(now, 300),
      linkedin: [
        { hook: "Every forwarder has the envelope.", body: "Month end in a freight office: an envelope of shipping bills and someone retyping every charge line. We built Doc Ledger so the team photographs the bill and checks the fields instead. What is the one document your finance team hates retyping?" },
        { hook: "What we learned this week.", body: "Three freight companies told us the same thing: their accountant keys the bills, not their staff. So this week we are talking to accountants too." },
      ],
      listing: { tagline: "Receipts into accounts, on your terms", description: "Doc Ledger reads shipping bills, fuel receipts and petty cash, converts currencies at the rate of the day, and lets each company define its own document types.", categories: ["Expense management", "Accounting", "Logistics"] },
      page: { headline: "Stop retyping shipping bills", subheadline: "Photograph the bill, check the fields, done.", points: ["Every charge line, BL and container number", "Foreign currency fixed at the rate of the day", "Your own document types when ours do not fit"], cta: "Start the free month" },
    },
    report: { at: ago(now, 600), text: "Founder report from Finance, last 7 days\nLeads found: 11, partners found: 2\nEmails sent: 4, replies: 1, demos: 0" },
    customers: [],
    social: {
      connected: true,
      autoPost: false,
      postsPerDay: 2,
      trustApprovedInARow: 3,
      followers: 42,
      week: { posts: 3, reactions: 17, comments: 4, shares: 2, views: 380 },
      plan: {
        at: ago(now, 1440),
        items: [
          { day: 0, theme: "the problem", idea: "Month end in a freight office: the envelope of shipping bills", status: "drafted" },
          { day: 1, theme: "product tip", idea: "Every charge line, BL and container number from one photo", status: "drafted" },
          { day: 2, theme: "demo invite", idea: "Try the demo company, no signup", status: "planned" },
          { day: 3, theme: "UAE finance tip", idea: "Keep the TRN on every bill you save", status: "planned" },
        ],
      },
      recent: [
        { id: "sp1", text: "Every forwarder knows the envelope: month end, a pile of shipping bills, and someone retyping every charge line.\nDoc Ledger reads the bill from a photo. Your team checks it and saves.\nTry the demo company, no signup.", status: "posted", postedAt: ago(now, 1300), imageUrl: "https://docledger.site/landing/review.jpg", stats: { reactions: 11, comments: 3, shares: 2, views: 240, at: ago(now, 60) } },
        { id: "sp2", text: "Bills in dollars, euros and yuan? Doc Ledger converts each one into dirhams at the rate of the day.", status: "draft", postedAt: null, imageUrl: "https://docledger.site/landing/records.jpg", stats: null },
      ],
    },
  };
}

// Wall Street fixtures (D075): a busy evening on the floor for screenshots.
const MOCK_VOICES = [
  { who: "Hound", say: "Two chip supply deals this morning, not fully priced in. No earnings until next month.", vote: "buy" },
  { who: "Quant", say: "Clean breakout over 123.50 on twice normal volume, RSI 68. Stop under 121.40, the morning low.", vote: "buy" },
  { who: "Strategist", say: "Chips lead a firm tape, SPY up 0.4 percent. Fed speakers after lunch are the one risk.", vote: "buy" },
  { who: "Bull", say: "News, chart and tide agree. The Fed risk is a reason for half size, not for sitting out.", vote: "buy" },
  { who: "Bear", say: "RSI near 70 into a Fed speech. Breakouts that late in the day often fade. I would wait.", vote: "pass" },
  { who: "Risk Officer", say: "12 USD fits with the stop at 121.40. A gap through it costs about 0.30 more.", vote: "buy" },
];
export function mockTradingState(now = new Date()): TradingStateView {
  const at = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
  return {
    desks: [
      { slug: "ai_crypto", name: "Night Desk", market: "crypto", style: "ai", equityUsd: 103.42, pnlPct: 3.42, status: "live", open: 2 },
      { slug: "index", name: "Lazy Larry", market: "stocks", style: "hold", equityUsd: 101.88, pnlPct: 1.88, status: "live", open: 1 },
      { slug: "ai_stocks", name: "AI Desk", market: "stocks", style: "ai", equityUsd: 100.61, pnlPct: 0.61, status: "live", open: 3 },
      { slug: "quant", name: "Quant Bot", market: "stocks", style: "quant", equityUsd: 98.73, pnlPct: -1.27, status: "benched", open: 0 },
    ],
    tape: [
      { s: "SPY", p: 571.24, chg: 0.42, m: "stocks" },
      { s: "QQQ", p: 492.1, chg: 0.77, m: "stocks" },
      { s: "NVDA", p: 124.31, chg: 2.31, m: "stocks" },
      { s: "AAPL", p: 229.8, chg: -0.35, m: "stocks" },
      { s: "TSLA", p: 251.6, chg: -1.92, m: "stocks" },
      { s: "META", p: 566.4, chg: 1.04, m: "stocks" },
      { s: "BTC", p: 64210, chg: 1.6, m: "crypto" },
      { s: "ETH", p: 2612.5, chg: -0.8, m: "crypto" },
      { s: "SOL", p: 152.31, chg: 3.4, m: "crypto" },
    ],
    status: { at: at(2), stocksOpen: true, cryptoLive: true, stocksLive: true, hasKeys: true, source: "sim", nextOpen: at(-900), nextClose: at(-240), errors: [], aiLeftUsd: 1.62, aiSpentUsd: 0.38, aiLimitUsd: 2 },
    btcPct: 1.6,
    brief: { mood: "bullish", headline: "Chips lead, Fed speakers later" },
    voices: [
      { who: "Bear", right: 7, of: 10, allRight: 9, allOf: 12 },
      { who: "Quant", right: 6, of: 10, allRight: 7, allOf: 12 },
      { who: "Risk Officer", right: 6, of: 10, allRight: 7, allOf: 12 },
      { who: "Hound", right: 5, of: 10, allRight: 6, allOf: 12 },
      { who: "Strategist", right: 5, of: 10, allRight: 5, allOf: 12 },
      { who: "Bull", right: 4, of: 10, allRight: 5, allOf: 12 },
    ],
    events: [
      { id: 9, kind: "meeting", message: "Meeting on NVDA: 5 buy, 1 pass. The Chief says BUY, decided by Bull.", agentSlug: "trading_chief", data: { kind: "meeting", desk: "ai_stocks", symbol: "NVDA", voices: MOCK_VOICES, votes: { buy: 5, pass: 1 }, decision: "buy", reason: "The Bull answered the Bear: chip demand news backs the volume. Half size into the Fed.", decidedBy: "Bull" }, at: at(1) },
      { id: 8, kind: "signal", message: "Quant: NVDA breakout, score 74", agentSlug: "trading_quant", data: { kind: "signal", symbol: "NVDA", signal: "breakout", score: 74 }, at: at(2) },
      { id: 7, kind: "close_win", message: "Night Desk sold SOL: hit the target, won 0.84 USD", agentSlug: "trading_runner", data: { kind: "close_win", desk: "ai_crypto", symbol: "SOL/USD", pnlUsd: 0.84 }, at: at(6) },
    ],
  };
}

export function mockTradingDetail(now = new Date()): TradingDetail {
  const base = mockTradingState(now);
  const at = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
  const curve = (slug: string, end: number, wobble: number) => Array.from({ length: 60 }, (_, i) => ({ at: at((60 - i) * 120), v: Number((100 + ((end - 100) * i) / 59 + Math.sin(i / 3 + slug.length) * wobble).toFixed(2)) }));
  return {
    ...base,
    curves: [
      { slug: "ai_stocks", name: "AI Desk", points: curve("ai_stocks", 100.61, 0.6) },
      { slug: "ai_crypto", name: "Night Desk", points: curve("ai_crypto", 103.42, 1.2) },
      { slug: "quant", name: "Quant Bot", points: curve("quant", 98.73, 0.5) },
      { slug: "index", name: "Lazy Larry", points: curve("index", 101.88, 0.3) },
    ],
    positions: [
      { id: "p1", desk: "ai_stocks", symbol: "NVDA", market: "stocks", sizeUsd: 12, entry: 123.9, stop: 121.4, target: 127.6, initialStop: 121.4, last: 124.31, pnlUsd: 0.04, pnlPct: 0.33, rMultiple: 0.2, openedAt: at(1), thesis: "The Bull answered the Bear: chip demand news backs the volume. Half size into the Fed.", meeting: base.events[0]!.data, reviews: [] },
      { id: "p2", desk: "ai_crypto", symbol: "BTC/USD", market: "crypto", sizeUsd: 24, entry: 63650, stop: 63650, target: 65500, initialStop: 62800, last: 64210, pnlUsd: 0.21, pnlPct: 0.88, rMultiple: 0.7, openedAt: at(300), thesis: "Higher lows all day, funding calm.", meeting: null, reviews: [{ at: at(60), action: "tighten", reason: "Up 1R: stop to the entry, a free trade now.", decidedBy: "Risk Officer" }] },
      { id: "p3", desk: "index", symbol: "SPY", market: "stocks", sizeUsd: 100, entry: 560.7, stop: null, target: null, initialStop: null, last: 571.24, pnlUsd: 1.88, pnlPct: 1.88, rMultiple: null, openedAt: at(9000), thesis: "Buy the whole market and hold it.", meeting: null, reviews: [] },
    ],
    trades: [
      { id: "c1", desk: "ai_crypto", symbol: "SOL/USD", market: "crypto", sizeUsd: 20, entry: 147.2, exit: 153.6, reason: "target", pnlUsd: 0.84, pnlPct: 4.2, rMultiple: 2.1, holdHours: 9.9, openedAt: at(600), closedAt: at(6), thesis: "Pullback in an uptrend, volume back.", meeting: { voices: [{ who: "Bull", say: "Uptrend intact, buyers stepped in at the 50 day line.", vote: "buy" }, { who: "Bear", say: "Crypto fees eat small moves.", vote: "pass" }], decision: "buy", reason: "Room to the target is three times the fee.", decidedBy: "Quant" }, lesson: "Waiting for the pullback paid: entry near support, exit at the plan.", reviews: [{ at: at(200), action: "hold", reason: "Trend intact, nothing to do.", decidedBy: "Chief" }] },
      { id: "c2", desk: "quant", symbol: "TSLA", market: "stocks", sizeUsd: 25, entry: 258.1, exit: 252.9, reason: "stop", pnlUsd: -0.5, pnlPct: -2.0, rMultiple: -1, holdHours: 5.2, openedAt: at(400), closedAt: at(90), thesis: "Quant rule: breakout, score 71.", meeting: null, lesson: null, reviews: [] },
      { id: "c3", desk: "ai_stocks", symbol: "AMD", market: "stocks", sizeUsd: 15, entry: 160.2, exit: 163.4, reason: "trail", pnlUsd: 0.3, pnlPct: 2.0, rMultiple: 1.4, holdHours: 26, openedAt: at(2000), closedAt: at(440), thesis: "Chips lead, AMD follows NVDA with a lag.", meeting: null, lesson: "The trail kept most of the move.", reviews: [] },
    ],
    meetings: [{ id: "s1", symbol: "NVDA", desk: "ai_stocks", status: "taken", score: 74, kind: "breakout", meeting: base.events[0]!.data, at: at(1) }],
    calls: [
      { id: "s1", symbol: "NVDA", market: "stocks", desk: "ai_stocks", status: "taken", score: 74, kind: "breakout", meeting: base.events[0]!.data, at: at(1), outcome: { state: "open", pnlUsd: null } },
      { id: "s2", symbol: "SOL/USD", market: "crypto", desk: "ai_crypto", status: "taken", score: 71, kind: "pullback", meeting: { voices: [{ who: "Bull", say: "Uptrend intact, buyers stepped in at the 50 day line.", vote: "buy" }, { who: "Bear", say: "Crypto fees eat small moves.", vote: "pass" }, { who: "Risk Officer", say: "20 USD, stop at 144.", vote: "buy" }], votes: { buy: 5, pass: 1 }, decision: "buy", reason: "Room to the target is three times the fee.", decidedBy: "Quant" }, at: at(600), outcome: { state: "won", pnlUsd: 0.84 } },
      { id: "s3", symbol: "TSLA", market: "stocks", desk: "ai_stocks", status: "passed", score: 66, kind: "momentum", meeting: { voices: [{ who: "Hound", say: "Delivery numbers tomorrow, anything can happen.", vote: "pass" }, { who: "Quant", say: "Momentum, but into resistance at 262.", vote: "pass" }, { who: "Bull", say: "Momentum is momentum.", vote: "buy" }, { who: "Bear", say: "Into earnings with a stretched RSI. No.", vote: "pass" }], votes: { buy: 1, pass: 5 }, decision: "pass", reason: "Earnings tomorrow and resistance overhead: the Bear is right.", decidedBy: "Bear" }, at: at(420), outcome: { state: "none", pnlUsd: null } },
      { id: "s4", symbol: "DOGE/USD", market: "crypto", desk: "ai_crypto", status: "vetoed", score: 63, kind: "volume", meeting: { voices: [{ who: "Risk Officer", say: "Stop would sit inside the fee. Veto.", vote: "pass" }], votes: { buy: 3, pass: 3 }, decision: "pass", reason: "The Risk Officer vetoed: the target cannot clear the fees.", decidedBy: "Risk Officer" }, at: at(1500), outcome: { state: "none", pnlUsd: null } },
    ],
    lessons: ["Trade with the daily trend, never against it.", "Skip crypto moves smaller than three times the fee."],
    plan: { dayKey: "2026-10-01", mode: "normal", focus: ["NVDA", "AMD", "SOL/USD"], avoid: ["TSLA"], plan: "Trade the chip leaders with the trend, half size into the Fed. Cut anything that loses its morning low.", strategist: "A firm tape led by chips. The edge is in leaders, not laggards. Fed speakers after lunch can turn it.", at: at(180) },
    briefFull: { dayKey: "2026-10-01", mood: "bullish", headline: "Chips lead, Fed speakers later", watch: ["NVDA", "AMD", "SOL/USD"], avoid: ["TSLA"], notes: "Futures firm on chip strength. Two Fed speakers after lunch in New York could move rates.", at: at(120) },
    kinds: { breakout: { wins: 5, losses: 4 }, momentum: { wins: 2, losses: 1 }, pullback: { wins: 3, losses: 0 }, volume: { wins: 1, losses: 3 } },
    memo: { memo: "Pullbacks in uptrends paid, late day breakouts did not. Trust the Bear when RSI is over 70. Rule for the week: no new trades in the last hour.", at: at(3000) },
    aiCost: { todayUsd: 0.38, totalUsd: 1.92 },
    startUsd: 100,
    stats: { signalsToday: 17, meetingsToday: 5, tradesTotal: 12, winRate: 58 },
    bench: Array.from({ length: 60 }, (_, i) => ({ at: at((60 - i) * 120), spy: Number((565 + i * 0.1 + Math.sin(i / 4) * 1.2).toFixed(2)), btc: Number((63200 + i * 17 + Math.cos(i / 3) * 180).toFixed(0)) })),
    reports: [
      { kind: "week", title: "Weekly report card, week of 2026-09-28", body: "Wall Street weekly report card\n\n1. Night Desk: 103.42 USD, up 3.42 percent\n2. Lazy Larry: 101.88 USD, up 1.88 percent\n3. AI Desk: 100.61 USD, up 0.61 percent\n4. Quant Bot: 98.73 USD, down 1.27 percent (benched)\nBitcoin held since the start: up 1.60 percent\n\nTrades closed: 12 (7 won, 5 lost or even).\nBest: SOL, up 0.84 USD. Worst: TSLA, down 0.50 USD.\nAI cost: 9.80 USD. Paper money only, nothing real was bought.", extra: "Pullbacks in uptrends paid, late day breakouts did not. Trust the Bear when RSI is over 70.", at: at(2600) },
      { kind: "close", title: "Close report, 2026-10-01", body: "Wall Street close, 2026-10-01\n\n1. Night Desk: 102.90 USD, up 2.90 percent\n2. Lazy Larry: 101.40 USD, up 1.40 percent\n3. AI Desk: 100.20 USD, up 0.20 percent\n4. Quant Bot: 98.73 USD, down 1.27 percent (benched)\n\nTrades closed: 3 (2 won, 1 lost or even).\nBest: AMD, up 0.30 USD. Worst: TSLA, down 0.50 USD.\nAI cost: 1.70 USD. Paper money only, nothing real was bought.", extra: "The Quant Bot chased a breakout into resistance. The AI Desk waited and won small. Patience paid.", at: at(900) },
    ],
    analytics: {
      overall: { trades: 12, wins: 7, pnlUsd: 2.61, avgR: 0.6, profitFactor: 1.9, expectancyUsd: 0.22, avgHoldHours: 11.4, best: { symbol: "SOL/USD", pnlUsd: 0.84 }, worst: { symbol: "TSLA", pnlUsd: -0.5 } },
      byDesk: { ai_crypto: { trades: 5, wins: 4, pnlUsd: 2.4, avgR: 1.1, profitFactor: 4.2 }, ai_stocks: { trades: 4, wins: 2, pnlUsd: 0.71, avgR: 0.4, profitFactor: 1.6 }, quant: { trades: 3, wins: 1, pnlUsd: -0.5, avgR: -0.3, profitFactor: 0.6 } },
      byKind: { pullback: { trades: 3, wins: 3, pnlUsd: 1.9, avgR: 1.6, profitFactor: null }, breakout: { trades: 6, wins: 3, pnlUsd: 0.81, avgR: 0.3, profitFactor: 1.4 }, momentum: { trades: 2, wins: 1, pnlUsd: 0.1, avgR: 0.1, profitFactor: 1.1 }, volume: { trades: 1, wins: 0, pnlUsd: -0.2, avgR: -1, profitFactor: 0 } },
      bySector: { crypto: { trades: 5, wins: 4, pnlUsd: 2.4, avgR: 1.1, profitFactor: 4.2 }, chips: { trades: 4, wins: 3, pnlUsd: 0.9, avgR: 0.7, profitFactor: 3 }, cars: { trades: 2, wins: 0, pnlUsd: -0.69, avgR: -1, profitFactor: 0 }, index: { trades: 1, wins: 0, pnlUsd: 0, avgR: null, profitFactor: null } },
      byHour: [
        { hour: 9, trades: 2, pnlUsd: 0.4 },
        { hour: 17, trades: 3, pnlUsd: 0.9 },
        { hour: 18, trades: 4, pnlUsd: 1.5 },
        { hour: 22, trades: 2, pnlUsd: -0.6 },
        { hour: 23, trades: 1, pnlUsd: 0.41 },
      ],
      drawdownPct: { ai_stocks: 1.2, ai_crypto: 2.1, quant: 2.7, index: 0.9 },
      aiVsPnl: { aiUsd: 1.92, pnlUsd: 2.61 },
    },
    exposure: { ai_stocks: { chips: 12 }, ai_crypto: { crypto: 24 }, index: { index: 100 } },
    dayPnl: { ai_stocks: { usd: 0.41, pct: 0.41 }, ai_crypto: { usd: 0.52, pct: 0.51 }, quant: { usd: 0, pct: 0 }, index: { usd: 0.48, pct: 0.47 } },
  };
}
