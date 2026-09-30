// Fixture state for local screenshots and tests. Never used on Vercel: only when TOWER_MOCK_STATE is 1.
import { AGENTS, FLOORS, SETUP_ITEMS } from "@/config/tower";
import type { MailMessage, MailThread, MailThreadDetail } from "@/lib/mailbox";
import type { TowerState } from "@/lib/state";
import type { AgentDetail, FloorDetail, WardenSummary } from "@/lib/detail";

export function mockState(now = new Date()): TowerState {
  const floors = FLOORS.map((f) => ({
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
    missingSetup: f.slug === "deals" ? ["affiliate_amazon_ae", "deals_channel"] : [],
    isBusiness: f.isBusiness,
    agents: AGENTS.filter((a) => a.floorSlug === f.slug).map((a, i) => {
      const status = a.kind === "warden" ? "idle" : a.slug === "docledger_chaser" ? "blocked" : a.slug === "deals_editor" ? "idle" : i % 2 === 0 ? "working" : "idle";
      const titles: Record<string, string> = {
        docledger_scout: "Find freight forwarders",
        docledger_writer: "Draft outreach email",
        docledger_builder: "Fix invoice export",
        deals_scout: "Scan Amazon deals",
        deals_publisher: "Publish deal post",
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
        currentTask: status === "idle" ? null : { id: `task_${a.slug}`, title: titles[a.slug] ?? "Chase warm reply", kind: "x", status: status === "blocked" ? "blocked" : "running", startedAt: now.toISOString(), dueAt: null, blockedReason: status === "blocked" ? "Need the calendar link to book the demo" : null },
        stats: { tasksDone: 12 + i * 3, tasksFailed: 1, successRate: 92, avgReviewScore: 8.1 },
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
    weeklyActual: f.slug === "deals" ? 9 : 0,
    measure: f.slug === "deals" ? "Posts published this week (subscriber count arrives with the channel)" : f.slug === "docledger" ? "Demos booked this week" : f.goalMetric,
    unlockRule: f.unlockRule,
    strategyNote: f.strategyNote,
    strategyUpdatedAt: f.strategyNote ? ago(now, 600) : null,
    pausedReason: null,
    throttledUntil: null,
    niche: f.slug === "docledger" ? "freight forwarders" : f.slug === "deals" ? "UAE online deals" : null,
    monthlyGuideUsd: live ? 9 : 0,
    autoApprove: false,
    isBusiness: f.isBusiness,
    missingSetup: f.missingSetup.map((k) => ({ key: k, label: SETUP_ITEMS.find((s) => s.key === k)?.label ?? k })),
    agents: f.agents.map((a) => ({ id: a.id, slug: a.slug, name: a.name, role: a.role, status: a.status })),
    activeTasks: active,
    blockers: active.filter((t) => t.status === "blocked").map((t) => ({ taskId: t.id, title: t.title, agentName: t.agentName, reason: t.blockedReason ?? "", since: ago(now, 12) })),
    queued: live ? 2 : 0,
    doneThisWeek: f.slug === "docledger" ? 23 : f.slug === "deals" ? 41 : 0,
    money: {
      revenueWeekUsd: f.slug === "deals" ? 12.4 : 0,
      revenueTotalUsd: f.slug === "deals" ? 52.4 : 0,
      spendWeekUsd: f.slug === "docledger" ? 2.1 : f.slug === "deals" ? 1.4 : 0,
      spendTodayUsd: f.slug === "docledger" ? 0.55 : f.slug === "deals" ? 0.38 : 0,
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
        "Deals Engine runs simulated until you paste: Amazon.ae Associates tag, Telegram deals channel handle",
        "Anthropic API key: the building stays in simulation until it is on the clipboard",
      ],
      floors: [
        { slug: "penthouse", name: "Penthouse", level: 5, line: "Warden at the desk, last run Reviewed the queue, reassigned two stale tasks, spend is inside the cap." },
        { slug: "docledger", name: "DocLedger Sales", level: 4, line: "4 done today, 2 at work, 1 blocked, spent 0.55 USD, note: Jebel Ali forwarders answer faster. Scout shifts there this week." },
        { slug: "deals", name: "Deals Engine", level: 3, line: "7 done today, 2 at work, spent 0.38 USD, earned 12.40 USD" },
        { slug: "content", name: "Content Studio", level: 2, line: "Unlocks when tower net earnings pass 100 USD and budget level is 2 or higher" },
        { slug: "service", name: "Consulting Desk", level: 1, line: "Unlocks after the first DocLedger demo is booked and budget level is 2 or higher" },
        { slug: "lobby", name: "Lobby", level: 0, line: "Petty cash 38.20 USD in the drawer" },
      ],
      notes: ["Reviewed the queue, reassigned two stale tasks, spend is inside the cap.", "One worker raised a hand. Went down, unblocked it, back in the office."],
    },
    budget: {
      level: 1,
      dailyCapUsd: 1.7,
      hardCeilingUsd: 5,
      spendTodayUsd: 0.93,
      todayByFloor: [{ slug: "docledger", name: "DocLedger Sales", usd: 0.55 }, { slug: "deals", name: "Deals Engine", usd: 0.38 }],
      allocationGuide: { warden: 6, deals: 9, docledger: 9, builder: 12, web_search: 9, buffer: 5 },
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
      id: "ap3", type: "public_post", status: "pending",
      summary: "Post to the deals channel: Anker 65W charger 38 percent off",
      content: { body: "Anker 65W GaN charger\nAED 89, was AED 145 (38 percent off)\nAmazon.ae, ships today\nhttps://example.invalid/amazon/anker65", store: "amazon_ae", dealId: "d1" },
      previewUrl: null, riskNote: "Public post on the Telegram channel with an affiliate link.", feedback: null,
      taskId: "t5", agentId: "agent_deals_editor", floorId: "floor_deals", simulated: true, createdAt: ago(now, 15), decidedAt: null, decidedVia: null,
    },
  ];
}

export function mockIdeas(now = new Date()) {
  return [
    { id: "i2", text: "Post the best deal of the day at 6pm", source: "telegram", status: "new", floorId: null, ticketId: null, wardenReply: null, handledAt: null, createdAt: ago(now, 60) },
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
