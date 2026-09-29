// Fixture state for local screenshots and tests. Never used on Vercel: only when TOWER_MOCK_STATE is 1.
import { AGENTS, FLOORS, SETUP_ITEMS } from "@/config/tower";
import type { TowerState } from "@/lib/state";

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
    missingSetup: f.slug === "deals" ? ["affiliate_amazon_ae", "deals_channel"] : [],
    isBusiness: f.isBusiness,
    agents: AGENTS.filter((a) => a.floorSlug === f.slug).map((a, i) => {
      const status = a.kind === "warden" ? "idle" : a.slug === "docledger_chaser" ? "blocked" : i % 2 === 0 ? "working" : "idle";
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
