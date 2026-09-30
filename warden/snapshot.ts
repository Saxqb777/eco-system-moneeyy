// The compact state Warden reads each run: about 4k tokens at most, everything else stays in the database.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { FLOOR_REQUIREMENTS } from "@/config/tower";
import type { Db } from "@/db/client";
import { agents, approvals, budgetLedger, clicks, deals, floors, ideas, posts, setupItems, tasks, wardenRuns } from "@/db/schema";
import { botChats, channelHealthFrom } from "@/lib/channel";
import { weeklyActual } from "@/lib/detail";
import { asNumber, getSettings } from "@/lib/settings";
import { dubaiDayStartUtc, dubaiParts, dubaiWeekStartUtc } from "@/lib/time";

export interface Snapshot {
  now: string;
  dayKey: string;
  weekday: string;
  budget: { level: number; dailyCapUsd: number; hardCeilingUsd: number; spentTodayUsd: number; spentByFloor: Record<string, number>; allocationGuideUsd: Record<string, number> };
  floors: Array<{
    slug: string;
    name: string;
    status: string;
    goal: string;
    weeklyTarget: number;
    weeklyActual: number;
    measure: string;
    doneThisWeek: number;
    strategyNote: string | null;
    missingSetup: string[];
    throttled: boolean;
    autoApprove: boolean;
    postedTotal?: number;
    firstPostDay?: string | null;
    channel?: { members: number | null; growthDay: number | null; growthWeek: number | null; botCanPost: boolean | null; engagementPostsThisWeek: number; clicksThisWeek: number; topCategories: string[]; shareChats: number; shareSpotsKnown: number };
    crew: Array<{ slug: string; name: string; role: string; status: string; task: string | null }>;
    queued: number;
    blocked: Array<{ taskId: string; agent: string; title: string; reason: string }>;
  }>;
  toReview: Array<{ taskId: string; agent: string; kind: string; title: string; output: string }>;
  pendingApprovals: Array<{ type: string; summary: string }>;
  clipboardMissing: string[];
  newIdeas: Array<{ ideaId: string; text: string }>;
  lastRuns: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

export async function buildSnapshot(db: Db, now = new Date()): Promise<Snapshot> {
  const settingsMap = await getSettings(db);
  const dayStart = dubaiDayStartUtc(now);
  const weekStart = dubaiWeekStartUtc(now);
  const p = dubaiParts(now);

  const floorRows = await db.select().from(floors).orderBy(desc(floors.level));
  const agentRows = await db.select().from(agents);
  const spendRows = await db
    .select({ floorId: budgetLedger.floorId, t: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` })
    .from(budgetLedger)
    .where(and(eq(budgetLedger.simulated, false), inArray(budgetLedger.kind, ["api_cost", "web_search"]), gte(budgetLedger.occurredAt, dayStart)))
    .groupBy(budgetLedger.floorId);
  const doneRows = await db
    .select({ floorId: tasks.floorId, n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.simulated, false), eq(tasks.status, "done"), gte(tasks.finishedAt, weekStart)))
    .groupBy(tasks.floorId);
  const queuedRows = await db
    .select({ floorId: tasks.floorId, n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.simulated, false), eq(tasks.status, "queued")))
    .groupBy(tasks.floorId);
  const blockedRows = await db.select().from(tasks).where(and(eq(tasks.simulated, false), eq(tasks.status, "blocked"))).limit(10);
  const reviewRows = await db.select().from(tasks).where(and(eq(tasks.simulated, false), eq(tasks.status, "review"))).orderBy(tasks.finishedAt).limit(12);
  const currentIds = agentRows.map((a) => a.currentTaskId).filter((x): x is string => !!x);
  const currentTasks = currentIds.length ? await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, currentIds)) : [];
  const titleById = new Map(currentTasks.map((t) => [t.id, t.title]));
  const setupRows = await db.select().from(setupItems);
  const present = new Set(setupRows.filter((s) => s.status === "present").map((s) => s.key));
  const pending = await db.select({ type: approvals.type, summary: approvals.summary }).from(approvals).where(and(eq(approvals.status, "pending"), eq(approvals.simulated, false))).limit(6);
  const newIdeas = await db.select({ id: ideas.id, text: ideas.text }).from(ideas).where(eq(ideas.status, "new")).orderBy(ideas.createdAt).limit(6);
  const [postStats] = await db.select({ n: sql<string>`count(*)`, first: sql<string | null>`min(${posts.postedAt})` }).from(posts).where(and(eq(posts.simulated, false), eq(posts.status, "posted")));
  const [engagementStats] = await db.select({ n: sql<string>`count(*)` }).from(posts).where(and(eq(posts.simulated, false), eq(posts.status, "posted"), sql`${posts.kind} <> 'deal'`, gte(posts.postedAt, weekStart)));
  const [clickStats] = await db.select({ n: sql<string>`count(*)` }).from(clicks).where(gte(clicks.ts, weekStart));
  const catRows = await db
    .select({ category: deals.category, n: sql<string>`count(*)` })
    .from(clicks)
    .innerJoin(deals, eq(deals.id, clicks.dealId))
    .where(gte(clicks.ts, new Date(now.getTime() - 14 * 24 * 3600 * 1000)))
    .groupBy(deals.category)
    .orderBy(desc(sql`count(*)`))
    .limit(3);
  const channelHealth = channelHealthFrom(settingsMap, p.dayKey);
  const shareSpots = Array.isArray(settingsMap.share_spots) ? settingsMap.share_spots.length : 0;
  const runs = await db.select({ summary: wardenRuns.summary }).from(wardenRuns).where(and(eq(wardenRuns.simulated, false), eq(wardenRuns.status, "applied"))).orderBy(desc(wardenRuns.startedAt)).limit(3);

  const spentByFloor: Record<string, number> = {};
  let spentToday = 0;
  const slugById = new Map(floorRows.map((f) => [f.id, f.slug]));
  for (const r of spendRows) {
    const v = Number(r.t);
    spentToday += v;
    spentByFloor[(r.floorId && slugById.get(r.floorId)) || "none"] = Math.round(v * 1000) / 1000;
  }
  const doneByFloor = new Map(doneRows.map((r) => [r.floorId ?? "", Number(r.n)]));
  const queuedByFloor = new Map(queuedRows.map((r) => [r.floorId ?? "", Number(r.n)]));
  const agentById = new Map(agentRows.map((a) => [a.id, a]));

  return {
    now: `${p.dayKey} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} Dubai`,
    dayKey: p.dayKey,
    weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(now.getTime() + 4 * 3600 * 1000).getUTCDay()] ?? "",
    budget: {
      level: asNumber(settingsMap.budget_level, 1),
      dailyCapUsd: asNumber(settingsMap.daily_cap_usd, 1.7),
      hardCeilingUsd: asNumber(settingsMap.hard_ceiling_usd, 5),
      spentTodayUsd: Math.round(spentToday * 1000) / 1000,
      spentByFloor,
      allocationGuideUsd: (settingsMap.allocation_guide_usd ?? {}) as Record<string, number>,
    },
    floors: await Promise.all(floorRows
      .filter((f) => f.slug !== "lobby")
      .map(async (f) => ({
        slug: f.slug,
        ...(await weeklyActual(db, f, false, weekStart).then((w) => ({ weeklyActual: w.value, measure: w.measure }))),
        name: f.name,
        status: f.status,
        goal: `${f.goalMetric}, weekly target ${Number(f.weeklyTarget)} ${f.targetUnit}`.trim(),
        weeklyTarget: Number(f.weeklyTarget),
        doneThisWeek: doneByFloor.get(f.id) ?? 0,
        strategyNote: f.strategyNote ? clip(f.strategyNote, 200) : null,
        missingSetup: (FLOOR_REQUIREMENTS[f.slug] ?? []).filter((k) => !present.has(k)),
        throttled: !!f.throttledUntil && f.throttledUntil.getTime() > now.getTime(),
        autoApprove: f.autoApprove,
        ...(f.slug === "deals"
          ? {
              postedTotal: Number(postStats?.n ?? 0),
              firstPostDay: postStats?.first ? String(postStats.first).slice(0, 10) : null,
              channel: {
                members: channelHealth.members,
                growthDay: channelHealth.growthDay,
                growthWeek: channelHealth.growthWeek,
                botCanPost: channelHealth.botCanPost,
                engagementPostsThisWeek: Number(engagementStats?.n ?? 0),
                clicksThisWeek: Number(clickStats?.n ?? 0),
                topCategories: catRows.map((r) => r.category ?? "general"),
                shareChats: botChats(settingsMap).filter((c) => c.addedByOwner && c.canPost).length,
                shareSpotsKnown: shareSpots,
              },
            }
          : {}),
        crew: agentRows
          .filter((a) => a.floorId === f.id && a.kind !== "warden")
          .map((a) => ({ slug: a.slug, name: a.name, role: a.role, status: a.status, task: a.currentTaskId ? (titleById.get(a.currentTaskId) ?? null) : null })),
        queued: queuedByFloor.get(f.id) ?? 0,
        blocked: blockedRows
          .filter((t) => t.floorId === f.id)
          .map((t) => ({ taskId: t.id, agent: (t.agentId && agentById.get(t.agentId)?.slug) || "unassigned", title: t.title, reason: clip(t.blockedReason ?? "", 160) })),
      }))),
    toReview: reviewRows.map((t) => ({ taskId: t.id, agent: (t.agentId && agentById.get(t.agentId)?.slug) || "unassigned", kind: t.kind, title: t.title, output: clip(JSON.stringify(t.output ?? {}), 600) })),
    pendingApprovals: pending.map((a) => ({ type: a.type, summary: clip(a.summary, 120) })),
    clipboardMissing: setupRows.filter((r) => r.status !== "present").map((r) => r.label),
    newIdeas: newIdeas.map((i) => ({ ideaId: i.id, text: clip(i.text, 240) })),
    lastRuns: runs.map((r) => clip(r.summary ?? "", 160)).filter(Boolean),
  };
}
