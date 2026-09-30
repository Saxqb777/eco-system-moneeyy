import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { resolveModel, type AgentModelKey } from "@/config/models";
import type { Db } from "@/db/client";
import {
  agentRuns,
  agents,
  approvals,
  budgetLedger,
  deals,
  floors,
  leads,
  outreach,
  posts,
  revenue,
  taskEvents,
  tasks,
  tickets,
  wardenRuns,
} from "@/db/schema";
import { computeCostUsd } from "@/lib/money";
import { asBool, getSettings, setSetting } from "@/lib/settings";
import { addMinutes, dubaiDayStartUtc, dubaiParts } from "@/lib/time";
import {
  BLOCK_REASONS,
  CITIES,
  COMPANY_PREFIX,
  COMPANY_SUFFIX,
  FIRST_NAMES,
  LAST_NAMES,
  PRODUCTS,
  REJECT_REASONS,
  SEGMENTS,
  STORES,
  STORE_LABEL,
  STRATEGY_NOTES,
  TICKET_TITLES,
  TITLES,
  WARDEN_SUMMARIES,
} from "./names";
import { SIM_PLAYBOOKS } from "./playbooks";
import { between, pick, rngFor } from "./rng";
import { describeTaskOutput } from "@/lib/tasks";
import { applyApprovalDecision } from "@/lib/approvals";
export { applyApprovalDecision };

const SLICE_MINUTES = 5;
const PENTHOUSE_LEVEL = 5;

type FloorRow = typeof floors.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

export interface SimSummary {
  skipped: boolean;
  slices: number;
  tasksStarted: number;
  tasksFinished: number;
  blocked: number;
  approvalsCreated: number;
  approvalsAutoDecided: number;
  revenueUsd: number;
  cursor: string | null;
}

interface World {
  floorsBySlug: Map<string, FloorRow>;
  floorsById: Map<string, FloorRow>;
  agents: AgentRow[];
  warden: AgentRow;
}

async function loadWorld(db: Db): Promise<World> {
  const floorRows = await db.select().from(floors);
  const agentRows = await db.select().from(agents);
  const floorsBySlug = new Map(floorRows.map((f) => [f.slug, f]));
  const floorsById = new Map(floorRows.map((f) => [f.id, f]));
  const warden = agentRows.find((a) => a.kind === "warden");
  if (!warden) throw new Error("Warden agent missing, run the seed");
  return { floorsBySlug, floorsById, agents: agentRows, warden };
}

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({
    taskId: e.taskId ?? null,
    agentId: e.agentId ?? null,
    floorId: e.floorId ?? null,
    type: e.type,
    message: e.message,
    data: (e.data as object) ?? null,
    createdAt: e.at,
  });
}

// Entry point. Advances the simulated world from the saved cursor to now in 5 minute slices.
export async function runSimulation(db: Db, now = new Date(), opts: { maxSlices?: number } = {}): Promise<SimSummary> {
  const settingsMap = await getSettings(db);
  const summary: SimSummary = { skipped: false, slices: 0, tasksStarted: 0, tasksFinished: 0, blocked: 0, approvalsCreated: 0, approvalsAutoDecided: 0, revenueUsd: 0, cursor: null };
  if (!asBool(settingsMap.simulation_mode, true)) return { ...summary, skipped: true };

  const maxSlices = opts.maxSlices ?? 72;
  const cursorRaw = settingsMap.sim_cursor as string | null;
  let cursor = cursorRaw ? new Date(cursorRaw) : addMinutes(now, -180);
  if (Number.isNaN(cursor.getTime()) || now.getTime() - cursor.getTime() > 12 * 60 * 60 * 1000) {
    cursor = addMinutes(now, -180);
  }

  const world = await loadWorld(db);
  let t = addMinutes(cursor, SLICE_MINUTES);
  while (t.getTime() <= now.getTime() && summary.slices < maxSlices) {
    await simulateSlice(db, world, t, summary);
    summary.slices += 1;
    cursor = t;
    t = addMinutes(t, SLICE_MINUTES);
  }
  if (t.getTime() > now.getTime()) cursor = now; // fully caught up

  await autoDecideApprovals(db, now, summary);
  await setSetting(db, "sim_cursor", cursor.toISOString());
  summary.cursor = cursor.toISOString();
  return summary;
}

async function simulateSlice(db: Db, world: World, t: Date, summary: SimSummary) {
  const parts = dubaiParts(t);
  const daytime = parts.hour >= 7 && parts.hour < 23;

  for (const agent of world.agents) {
    if (agent.kind === "warden") continue;
    const floor = agent.floorId ? world.floorsById.get(agent.floorId) : undefined;
    if (!floor || floor.status !== "live") continue;
    const playbook = SIM_PLAYBOOKS[agent.playbookKey];
    if (!playbook) continue;

    const rand = rngFor("slice", t.toISOString(), agent.slug);
    const current = agent.currentTaskId ? await getTask(db, agent.currentTaskId) : null;

    if (agent.status === "blocked" && current) {
      const resolveAt = readSim(current).resolveAt;
      if (resolveAt && t.getTime() >= new Date(resolveAt).getTime()) {
        await resolveBlocked(db, world, agent, current, floor, t, rand);
      }
      continue;
    }

    if ((agent.status === "working" || agent.status === "riding") && current) {
      if (current.dueAt && t.getTime() >= current.dueAt.getTime()) {
        await finishTask(db, world, agent, current, floor, t, rand, summary);
      }
      continue;
    }

    if (agent.status === "idle" || !current) {
      const active = playbook.nightOwl ? parts.hour >= 1 && parts.hour < 5 : daytime;
      if (!active) continue;
      const startedToday = await countTasksToday(db, agent.id, t);
      if (startedToday >= playbook.perDay) continue;
      const activeSlices = playbook.nightOwl ? 48 : 192;
      const chance = Math.min(0.9, (playbook.perDay / activeSlices) * 4);
      if (rand() < chance) {
        await startTask(db, agent, floor, playbook.kind, pick(rand, playbook.labels), t, rand, playbook.durationMin);
        summary.tasksStarted += 1;
      }
    }
  }

  // Warden's scheduled runs, every 4 hours on the hour in Dubai time.
  if (parts.hour % 4 === 0 && parts.minute < SLICE_MINUTES) {
    await simulateWardenRun(db, world, t);
  }

  // Occasional verified revenue so the counters move: about one commission every 30 hours per live business floor.
  for (const floor of world.floorsBySlug.values()) {
    if (!floor.isBusiness || floor.status !== "live") continue;
    const rand = rngFor("revenue", t.toISOString(), floor.slug);
    const perSlice = 1 / (30 * 12);
    if (rand() < perSlice) {
      const amount = floor.slug === "deals" ? between(rand, 2, 15) + rand() : between(rand, 150, 400);
      const source = floor.slug === "deals" ? "commission" : "invoice";
      const [row] = await db
        .insert(revenue)
        .values({ floorId: floor.id, source, amountUsd: amount.toFixed(2), currency: "USD", verified: true, verifiedAt: t, verifiedBy: "system", note: "SIMULATED", simulated: true, occurredAt: t, createdAt: t })
        .returning({ id: revenue.id });
      await db.insert(budgetLedger).values({ kind: "revenue", amountUsd: amount.toFixed(2), floorId: floor.id, revenueId: row?.id ?? null, verified: true, note: "SIMULATED", simulated: true, occurredAt: t, createdAt: t });
      summary.revenueUsd += amount;
    }
  }
}

function readSim(task: TaskRow): { resolveAt?: string; feedback?: string } {
  const input = (task.input ?? {}) as { sim?: { resolveAt?: string; feedback?: string } };
  return input.sim ?? {};
}

async function getTask(db: Db, id: string): Promise<TaskRow | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0] ?? null;
}

async function countTasksToday(db: Db, agentId: string, t: Date): Promise<number> {
  const dayStart = dubaiDayStartUtc(t);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.agentId, agentId), eq(tasks.simulated, true), gte(tasks.createdAt, dayStart)));
  return row?.n ?? 0;
}

async function startTask(db: Db, agent: AgentRow, floor: FloorRow, kind: string, title: string, t: Date, rand: () => number, durationMin: [number, number]) {
  // A rejected task waits in the queue with feedback and gets picked up first.
  const queued = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.agentId, agent.id), eq(tasks.status, "queued"), eq(tasks.simulated, true)))
    .orderBy(asc(tasks.createdAt))
    .limit(1);
  const duration = between(rand, durationMin[0], durationMin[1]);
  const dueAt = addMinutes(t, duration);
  let task = queued[0] ?? null;
  if (task) {
    await db.update(tasks).set({ status: "running", startedAt: t, dueAt, attempts: task.attempts + 1, updatedAt: t }).where(eq(tasks.id, task.id));
  } else {
    const [row] = await db
      .insert(tasks)
      .values({ floorId: floor.id, agentId: agent.id, kind, title, status: "running", priority: 5, input: { sim: {} }, attempts: 1, startedAt: t, dueAt, simulated: true, createdAt: t, updatedAt: t })
      .returning();
    task = row ?? null;
    if (task) await logEvent(db, { taskId: task.id, agentId: agent.id, floorId: floor.id, type: "created", message: `${title} queued`, at: t });
  }
  if (!task) return;
  await logEvent(db, { taskId: task.id, agentId: agent.id, floorId: floor.id, type: "started", message: `${agent.name} started: ${task.title}`, at: t });
  await db.update(agents).set({ status: "working", currentTaskId: task.id, locationLevel: floor.level, updatedAt: t }).where(eq(agents.id, agent.id));
  agent.status = "working";
  agent.currentTaskId = task.id;
}

async function finishTask(db: Db, world: World, agent: AgentRow, task: TaskRow, floor: FloorRow, t: Date, rand: () => number, summary: SimSummary) {
  const roll = rand();
  if (roll < 0.06 && world.warden.status === "idle") {
    await blockTask(db, world, agent, task, floor, t, rand);
    summary.blocked += 1;
    return;
  }
  const rejected = roll < 0.14;
  const modelKey = (agent.modelKey as AgentModelKey) ?? "worker";
  const model = resolveModel(modelKey);
  const playbook = SIM_PLAYBOOKS[agent.playbookKey];
  const usage = {
    inputTokens: between(rand, 4000, 20000),
    outputTokens: between(rand, 500, 3000),
    cacheReadTokens: between(rand, 0, 6000),
    cacheWriteTokens: between(rand, 0, 1500),
    webSearches: playbook?.searches ? between(rand, playbook.searches[0], playbook.searches[1]) : 0,
  };
  const mode = agent.kind === "builder" ? "sync" : "batch";
  const cost = computeCostUsd(model, usage, mode);
  const durationMs = task.startedAt ? t.getTime() - task.startedAt.getTime() : 0;

  const [run] = await db
    .insert(agentRuns)
    .values({ agentId: agent.id, taskId: task.id, floorId: floor.id, model, mode, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, webSearchCount: usage.webSearches, costUsd: cost.toFixed(6), durationMs, stopReason: "end_turn", simulated: true, startedAt: task.startedAt ?? t, finishedAt: t })
    .returning({ id: agentRuns.id });
  await db.insert(budgetLedger).values({ kind: "api_cost", amountUsd: cost.toFixed(6), floorId: floor.id, agentId: agent.id, taskId: task.id, agentRunId: run?.id ?? null, note: "SIMULATED", simulated: true, occurredAt: t, createdAt: t });

  let output: Record<string, unknown> = {};
  if (!rejected) {
    output = await produceOutput(db, agent, task, floor, t, rand, summary);
  }
  const score = rejected ? between(rand, 3, 5) : between(rand, 6, 10);
  const reason = rejected ? pick(rand, REJECT_REASONS) : "Meets the playbook, accepted";

  await logEvent(db, { taskId: task.id, agentId: agent.id, floorId: floor.id, type: "output", message: describeTaskOutput(task.kind, output, rejected), data: output, at: t });
  await logEvent(db, { taskId: task.id, agentId: world.warden.id, floorId: floor.id, type: "review", message: `Warden scored ${score}/10: ${reason}`, data: { score, reason }, at: t });

  if (rejected) {
    await db.update(tasks).set({ status: "rejected", output, reviewScore: score, reviewReason: reason, finishedAt: t, updatedAt: t }).where(eq(tasks.id, task.id));
    await logEvent(db, { taskId: task.id, agentId: agent.id, floorId: floor.id, type: "rejected", message: `Rejected, sent back with feedback`, at: t });
    // Requeue with the feedback attached so the worker redoes it.
    await db.insert(tasks).values({ floorId: floor.id, agentId: agent.id, kind: task.kind, title: task.title, status: "queued", priority: 3, input: { sim: { feedback: reason } }, feedback: reason, parentTaskId: task.id, attempts: 0, simulated: true, createdAt: t, updatedAt: t });
  } else {
    await db.update(tasks).set({ status: "done", output, reviewScore: score, reviewReason: reason, finishedAt: t, updatedAt: t }).where(eq(tasks.id, task.id));
    await logEvent(db, { taskId: task.id, agentId: agent.id, floorId: floor.id, type: "done", message: `${task.title} done`, at: t });
  }

  await db
    .update(agents)
    .set({
      status: "idle",
      currentTaskId: null,
      tasksDone: rejected ? agent.tasksDone : agent.tasksDone + 1,
      tasksFailed: rejected ? agent.tasksFailed + 1 : agent.tasksFailed,
      reviewScoreSum: (Number(agent.reviewScoreSum) + score).toFixed(2),
      reviewCount: agent.reviewCount + 1,
      updatedAt: t,
    })
    .where(eq(agents.id, agent.id));
  agent.status = "idle";
  agent.currentTaskId = null;
  agent.tasksDone = rejected ? agent.tasksDone : agent.tasksDone + 1;
  agent.tasksFailed = rejected ? agent.tasksFailed + 1 : agent.tasksFailed;
  agent.reviewScoreSum = (Number(agent.reviewScoreSum) + score).toFixed(2);
  agent.reviewCount = agent.reviewCount + 1;
  summary.tasksFinished += 1;
}

async function produceOutput(db: Db, agent: AgentRow, task: TaskRow, floor: FloorRow, t: Date, rand: () => number, summary: SimSummary): Promise<Record<string, unknown>> {
  switch (task.kind) {
    case "find_leads": {
      const n = between(rand, 3, 6);
      for (let i = 0; i < n; i++) {
        const segment = pick(rand, SEGMENTS);
        const company = `${pick(rand, COMPANY_PREFIX)} ${pick(rand, COMPANY_SUFFIX[segment] ?? ["Logistics"])}`;
        const key = `sim-${company.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.floor(rand() * 1e6)}`;
        await db.insert(leads).values({ floorId: floor.id, company, website: `https://${key.slice(4, 24).replace(/-+$/, "")}.example`, segment, city: pick(rand, CITIES), sourceUrl: "https://example.invalid/simulated", status: "new", dedupeKey: key, foundByTaskId: task.id, simulated: true, createdAt: t, updatedAt: t }).onConflictDoNothing();
      }
      return { found: n };
    }
    case "qualify_lead": {
      const [lead] = await db.select().from(leads).where(and(eq(leads.simulated, true), eq(leads.status, "new"))).orderBy(asc(leads.createdAt)).limit(1);
      if (!lead) return {};
      const score = between(rand, 3, 10);
      const qualified = score >= 6;
      const dm = { name: `${pick(rand, FIRST_NAMES)} ${pick(rand, LAST_NAMES)}`, title: pick(rand, TITLES), email: `contact@${(lead.website ?? "example.invalid").replace("https://", "")}`, confidence: between(rand, 5, 9) / 10 };
      const reason = qualified ? "Handles import documentation in house, 20 plus shipments a month, no visible software" : "Too small, likely under five shipments a month";
      await db.update(leads).set({ score, scoreReason: reason, decisionMaker: dm, status: qualified ? "qualified" : "disqualified", updatedAt: t }).where(eq(leads.id, lead.id));
      return { company: lead.company, score, qualified };
    }
    case "draft_outreach": {
      const candidates = await db
        .select({ lead: leads })
        .from(leads)
        .leftJoin(outreach, eq(outreach.leadId, leads.id))
        .where(and(eq(leads.simulated, true), eq(leads.status, "qualified"), isNull(outreach.id)))
        .limit(1);
      const lead = candidates[0]?.lead;
      if (!lead) return {};
      const dm = (lead.decisionMaker ?? {}) as { name?: string; title?: string };
      const subject = `Customs paperwork at ${lead.company}: 20 minutes to show a faster way`;
      const body = `Hi ${dm.name?.split(" ")[0] ?? "there"},\n\nTeams like ${lead.company} spend hours a week retyping shipment details into invoices and customs forms. DocLedger reads the documents once and fills the rest.\n\nWorth a 20 minute demo this week?\n\nSaaqib`;
      const [appr] = await db
        .insert(approvals)
        .values({ type: "outreach_email", status: "pending", summary: `Send first outreach email to ${dm.name ?? "the decision maker"} at ${lead.company}`, content: { to: lead.company, subject, body }, riskNote: "Cold email to a business address. One plain opt out line included.", taskId: task.id, agentId: agent.id, floorId: floor.id, simulated: true, createdAt: t, updatedAt: t })
        .returning({ id: approvals.id });
      await db.insert(outreach).values({ leadId: lead.id, step: 1, subject, bodyText: body, approvalId: appr?.id ?? null, status: "draft", simulated: true, createdAt: t, updatedAt: t });
      await db.update(leads).set({ status: "drafted", updatedAt: t }).where(eq(leads.id, lead.id));
      summary.approvalsCreated += 1;
      return { company: lead.company, subject };
    }
    case "follow_up": {
      const [sent] = await db.select().from(outreach).where(and(eq(outreach.simulated, true), eq(outreach.status, "sent"))).orderBy(asc(outreach.sentAt)).limit(1);
      if (!sent || !sent.leadId) return { result: "No sent email to follow up yet" };
      const roll = rand();
      if (roll < 0.25) {
        await db.update(outreach).set({ status: "replied", replyText: "Sounds interesting, send me some times.", replyAt: t, updatedAt: t }).where(eq(outreach.id, sent.id));
        await db.update(leads).set({ status: "replied", updatedAt: t }).where(eq(leads.id, sent.leadId));
        return { result: "Reply received, proposing demo times" };
      }
      if (roll < 0.4) {
        await db.update(outreach).set({ status: "replied", updatedAt: t }).where(eq(outreach.id, sent.id));
        await db.update(leads).set({ status: "demo_booked", updatedAt: t }).where(eq(leads.id, sent.leadId));
        return { result: "Demo booked through the calendar link" };
      }
      return { result: "Follow up sent, no reply yet" };
    }
    case "build_ticket": {
      const [backlog] = await db.select().from(tickets).where(and(eq(tickets.simulated, true), eq(tickets.status, "backlog"))).orderBy(asc(tickets.createdAt)).limit(1);
      let ticket = backlog ?? null;
      if (!ticket) {
        const [created] = await db.insert(tickets).values({ floorId: floor.id, source: "warden", title: pick(rand, TICKET_TITLES), description: "Simulated ticket", repo: "Saxqb777/docledger", status: "backlog", simulated: true, createdAt: t, updatedAt: t }).returning();
        ticket = created ?? null;
      }
      if (!ticket) return {};
      const branch = `builder/${ticket.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const prNumber = between(rand, 100, 400);
      const prUrl = `https://github.com/Saxqb777/docledger/pull/${prNumber}`;
      const [appr] = await db
        .insert(approvals)
        .values({ type: "pull_request", status: "pending", summary: `Merge pull request: ${ticket.title}`, content: { title: ticket.title, branch, tests: "12 passed", filesChanged: between(rand, 2, 9) }, previewUrl: prUrl, riskNote: "Code change on the DocLedger repo. Preview deployment attached.", taskId: task.id, agentId: agent.id, floorId: floor.id, simulated: true, createdAt: t, updatedAt: t })
        .returning({ id: approvals.id });
      await db.update(tickets).set({ status: "pr_open", branch, prUrl, previewUrl: `https://docledger-git-${branch.replace("/", "-")}.vercel.app`, approvalId: appr?.id ?? null, builderTaskId: task.id, costUsd: "0.31", updatedAt: t }).where(eq(tickets.id, ticket.id));
      summary.approvalsCreated += 1;
      return { title: ticket.title, prUrl };
    }
    case "find_deals": {
      const n = between(rand, 3, 6);
      for (let i = 0; i < n; i++) {
        const store = pick(rand, STORES);
        const title = pick(rand, PRODUCTS);
        const wasPrice = between(rand, 80, 2400);
        const discount = between(rand, 15, 55);
        const price = Math.round(wasPrice * (1 - discount / 100));
        const key = `sim-${store}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.floor(rand() * 1e6)}`;
        await db.insert(deals).values({ floorId: floor.id, store, title, url: `https://example.invalid/${store}/${key}`, price: String(price), wasPrice: String(wasPrice), discountPct: String(discount), currency: "AED", category: "electronics", status: "found", foundByTaskId: task.id, dedupeKey: key, simulated: true, createdAt: t, updatedAt: t }).onConflictDoNothing();
      }
      return { found: n };
    }
    case "write_post": {
      const [deal] = await db.select().from(deals).where(and(eq(deals.simulated, true), eq(deals.status, "found"))).orderBy(desc(deals.discountPct)).limit(1);
      if (!deal) return {};
      const body = `${deal.title}: AED ${deal.price} (was ${deal.wasPrice}, ${deal.discountPct}% off) at ${STORE_LABEL[deal.store] ?? deal.store}. Link in the post.`;
      const [appr] = await db
        .insert(approvals)
        .values({ type: "public_post", status: "pending", summary: `Post to the deals channel: ${deal.title}`, content: { body, store: deal.store, dealId: deal.id }, riskNote: "Public post on the Telegram channel with an affiliate link.", taskId: task.id, agentId: agent.id, floorId: floor.id, simulated: true, createdAt: t, updatedAt: t })
        .returning({ id: approvals.id });
      await db.insert(posts).values({ floorId: floor.id, kind: "deal", dealIds: [deal.id], body, channel: "telegram_channel", approvalId: appr?.id ?? null, status: "draft", simulated: true, createdAt: t, updatedAt: t });
      await db.update(deals).set({ status: "selected", updatedAt: t }).where(eq(deals.id, deal.id));
      summary.approvalsCreated += 1;
      return { title: deal.title };
    }
    case "publish_post": {
      const [post] = await db.select().from(posts).where(and(eq(posts.simulated, true), eq(posts.status, "approved"))).orderBy(asc(posts.createdAt)).limit(1);
      if (!post) return { posted: false };
      const clicks = between(rand, 3, 40);
      const code = `s${Math.floor(rand() * 36 ** 5).toString(36)}`;
      await db.update(posts).set({ status: "posted", postedAt: t, shortCode: code, clicks, updatedAt: t }).where(eq(posts.id, post.id));
      for (const dealId of post.dealIds) await db.update(deals).set({ status: "posted", updatedAt: t }).where(eq(deals.id, dealId));
      return { posted: true, clicks };
    }
    default:
      return {};
  }
}

async function blockTask(db: Db, world: World, agent: AgentRow, task: TaskRow, floor: FloorRow, t: Date, rand: () => number) {
  const block = pick(rand, BLOCK_REASONS);
  const resolveAt = addMinutes(t, between(rand, 10, 20));
  const input = { ...(task.input as object), sim: { ...readSim(task), resolveAt: resolveAt.toISOString() } };
  await db.update(tasks).set({ status: "blocked", blockedReason: block.reason, needsOwner: block.needsOwner, input, updatedAt: t }).where(eq(tasks.id, task.id));
  await db.update(agents).set({ status: "blocked", updatedAt: t }).where(eq(agents.id, agent.id));
  await logEvent(db, { taskId: task.id, agentId: agent.id, floorId: floor.id, type: "blocked", message: `${agent.name} is blocked: ${block.reason}`, at: t });
  await logEvent(db, { taskId: task.id, agentId: agent.id, floorId: floor.id, type: "help_requested", message: `${agent.name} raised a hand`, at: t });
  // Real state change: Warden rides the lift down to the floor.
  await db.update(agents).set({ status: "helping", locationLevel: floor.level, updatedAt: t }).where(eq(agents.id, world.warden.id));
  await logEvent(db, { taskId: task.id, agentId: world.warden.id, floorId: floor.id, type: "warden_dispatched", message: `Warden is riding the lift to ${floor.name}`, data: { from: PENTHOUSE_LEVEL, to: floor.level }, at: t });
  world.warden.status = "helping";
  world.warden.locationLevel = floor.level;
  agent.status = "blocked";
}

async function resolveBlocked(db: Db, world: World, agent: AgentRow, task: TaskRow, floor: FloorRow, t: Date, rand: () => number) {
  const dueAt = addMinutes(t, between(rand, 8, 18));
  await db.update(tasks).set({ status: "running", blockedReason: null, needsOwner: false, dueAt, updatedAt: t }).where(eq(tasks.id, task.id));
  await db.update(agents).set({ status: "working", updatedAt: t }).where(eq(agents.id, agent.id));
  await logEvent(db, { taskId: task.id, agentId: world.warden.id, floorId: floor.id, type: "warden_arrived", message: `Warden unblocked ${agent.name}: ${task.blockedReason ?? "sorted"}`, at: t });
  await db.update(agents).set({ status: "idle", locationLevel: PENTHOUSE_LEVEL, updatedAt: t }).where(eq(agents.id, world.warden.id));
  await logEvent(db, { taskId: null, agentId: world.warden.id, floorId: world.floorsBySlug.get("penthouse")?.id ?? null, type: "log", message: "Warden went back up to the Penthouse", data: { from: floor.level, to: PENTHOUSE_LEVEL }, at: t });
  world.warden.status = "idle";
  world.warden.locationLevel = PENTHOUSE_LEVEL;
  agent.status = "working";
}

async function simulateWardenRun(db: Db, world: World, t: Date) {
  const rand = rngFor("warden", t.toISOString());
  const model = resolveModel("warden");
  const usage = { inputTokens: between(rand, 6000, 11000), outputTokens: between(rand, 800, 1400) };
  const cost = computeCostUsd(model, usage, "batch");
  const summary = pick(rand, WARDEN_SUMMARIES);
  const [run] = await db
    .insert(agentRuns)
    .values({ agentId: world.warden.id, floorId: world.warden.floorId, model, mode: "batch", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: cost.toFixed(6), durationMs: between(rand, 20000, 90000), stopReason: "end_turn", simulated: true, startedAt: t, finishedAt: t })
    .returning({ id: agentRuns.id });
  await db.insert(budgetLedger).values({ kind: "api_cost", amountUsd: cost.toFixed(6), floorId: world.warden.floorId, agentId: world.warden.id, agentRunId: run?.id ?? null, note: "SIMULATED", simulated: true, occurredAt: t, createdAt: t });
  await db.insert(wardenRuns).values({ mode: "batch", trigger: "schedule", status: "applied", summary, decisions: { simulated: true }, costUsd: cost.toFixed(6), agentRunId: run?.id ?? null, startedAt: t, finishedAt: t, simulated: true });
  await logEvent(db, { agentId: world.warden.id, floorId: world.warden.floorId, type: "log", message: `Warden run: ${summary}`, at: t });
  if (rand() < 0.25) {
    const slug = pick(rand, ["docledger", "deals"]);
    const floor = world.floorsBySlug.get(slug);
    const notes = STRATEGY_NOTES[slug];
    if (floor && notes) {
      await db.update(floors).set({ strategyNote: pick(rand, notes), strategyUpdatedAt: t, updatedAt: t }).where(eq(floors.id, floor.id));
    }
  }
}

// Simulated approvals decide themselves after 3 hours so the queue never piles up while nobody watches.
async function autoDecideApprovals(db: Db, now: Date, summary: SimSummary) {
  const cutoff = addMinutes(now, -180);
  const stale = await db.select().from(approvals).where(and(eq(approvals.simulated, true), eq(approvals.status, "pending"), lt(approvals.createdAt, cutoff))).limit(20);
  for (const a of stale) {
    const rand = rngFor("approval", a.id);
    const approve = rand() < 0.85;
    await applyApprovalDecision(db, a.id, approve ? "approved" : "rejected", approve ? null : "Not this one, too pushy", "auto", now);
    summary.approvalsAutoDecided += 1;
  }
}

// Removes every simulated row. Only called from the settings API on explicit request.
export async function clearSimulationData(db: Db) {
  await db.delete(taskEvents).where(sql`${taskEvents.taskId} in (select id from ${tasks} where simulated = true) or ${taskEvents.message} like 'Warden run:%' or ${taskEvents.type} in ('warden_dispatched','warden_arrived')`);
  await db.delete(budgetLedger).where(eq(budgetLedger.simulated, true));
  await db.delete(agentRuns).where(eq(agentRuns.simulated, true));
  await db.delete(revenue).where(eq(revenue.simulated, true));
  await db.delete(outreach).where(eq(outreach.simulated, true));
  await db.delete(posts).where(eq(posts.simulated, true));
  await db.delete(deals).where(eq(deals.simulated, true));
  await db.delete(leads).where(eq(leads.simulated, true));
  await db.delete(tickets).where(eq(tickets.simulated, true));
  await db.delete(approvals).where(eq(approvals.simulated, true));
  await db.delete(wardenRuns).where(eq(wardenRuns.simulated, true));
  await db.delete(tasks).where(eq(tasks.simulated, true));
  await db.update(agents).set({ status: "idle", currentTaskId: null, tasksDone: 0, tasksFailed: 0, reviewScoreSum: "0", reviewCount: 0 });
  await db.update(floors).set({ strategyNote: null, strategyUpdatedAt: null });
  await setSetting(db, "sim_cursor", null);
}
