// Builder's night shift, seen from the Tower: hand out the top ticket, record the start and the result.
import { and, asc, eq } from "drizzle-orm";
import { getAnthropicKey } from "@/agents/client";
import type { Db } from "@/db/client";
import { agentRuns, agents, budgetLedger, taskEvents, tickets, tasks } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { clipboardValue } from "@/lib/clipboard";
import { asBool, getSettings } from "@/lib/settings";

export interface BuilderJob {
  ticket: { id: string; title: string; description: string | null; repo: string | null };
  repoUrl: string;
  caps: { toolCalls: number; usd: number; minutes: number };
}

async function builderAgent(db: Db) {
  const [a] = await db.select().from(agents).where(eq(agents.slug, "docledger_builder")).limit(1);
  return a ?? null;
}

// The top backlog ticket, or a reason why there is none tonight. Simulation mode never hands out real work.
export async function nextBuilderJob(db: Db): Promise<{ job: BuilderJob | null; reason?: string }> {
  const s = await getSettings(db);
  if (asBool(s.simulation_mode, true)) return { job: null, reason: "simulation mode" };
  const repoUrl = (await clipboardValue(db, "docledger_repo_url")) ?? "";
  if (!repoUrl) return { job: null, reason: "DocLedger repo URL not on the clipboard" };
  const [t] = await db.select().from(tickets).where(and(eq(tickets.simulated, false), eq(tickets.status, "backlog"))).orderBy(asc(tickets.createdAt)).limit(1);
  if (!t) return { job: null, reason: "backlog is empty" };
  return { job: { ticket: { id: t.id, title: t.title, description: t.description, repo: t.repo }, repoUrl, caps: { toolCalls: 25, usd: 0.4, minutes: 20 } } };
}

// Secrets the job needs, decrypted once, sent only over the authenticated route.
export async function builderSecrets(db: Db): Promise<{ anthropicKey: string | null; githubToken: string | null }> {
  return { anthropicKey: await getAnthropicKey(db), githubToken: await clipboardValue(db, "docledger_github_token") };
}

export async function startBuilderTicket(db: Db, ticketId: string, now = new Date()): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!t) return { ok: false, error: "ticket not found" };
  const builder = await builderAgent(db);
  const [task] = await db.insert(tasks).values({ floorId: t.floorId, agentId: builder?.id ?? null, kind: "build_ticket", title: t.title.slice(0, 60), status: "running", input: { ticketId: t.id }, startedAt: now, simulated: false, createdAt: now, updatedAt: now }).returning({ id: tasks.id });
  await db.update(tickets).set({ status: "building", builderTaskId: task?.id ?? null, updatedAt: now }).where(eq(tickets.id, t.id));
  if (builder) await db.update(agents).set({ status: "working", currentTaskId: task?.id ?? null, updatedAt: now }).where(eq(agents.id, builder.id));
  await db.insert(taskEvents).values({ taskId: task?.id ?? null, agentId: builder?.id ?? null, floorId: t.floorId, type: "started", message: `Builder started: ${t.title}`, createdAt: now });
  return { ok: true, taskId: task?.id };
}

export interface BuilderResult {
  ticketId: string;
  status: "pr_open" | "failed";
  branch?: string;
  prUrl?: string;
  previewUrl?: string;
  summary?: string;
  failureReason?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; costUsd: number; durationMs: number; toolCalls: number; model: string };
}

export async function finishBuilderTicket(db: Db, r: BuilderResult, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, r.ticketId)).limit(1);
  if (!t) return { ok: false, error: "ticket not found" };
  const builder = await builderAgent(db);
  const taskId = t.builderTaskId;
  if (r.usage) {
    const [run] = await db
      .insert(agentRuns)
      .values({ agentId: builder?.id ?? null, taskId, floorId: t.floorId, model: r.usage.model, mode: "sync", inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, cacheReadTokens: r.usage.cacheReadTokens ?? 0, cacheWriteTokens: r.usage.cacheWriteTokens ?? 0, costUsd: r.usage.costUsd.toFixed(6), durationMs: r.usage.durationMs, stopReason: r.status, simulated: false, startedAt: new Date(now.getTime() - r.usage.durationMs), finishedAt: now })
      .returning({ id: agentRuns.id });
    if (r.usage.costUsd > 0) await db.insert(budgetLedger).values({ kind: "api_cost", amountUsd: r.usage.costUsd.toFixed(6), floorId: t.floorId, agentId: builder?.id ?? null, taskId, agentRunId: run?.id ?? null, note: `Builder, ${r.usage.toolCalls} tool calls`, simulated: false, occurredAt: now, createdAt: now });
  }
  if (r.status === "pr_open") {
    const { id: approvalId } = await raiseApproval(db, {
      type: "pull_request",
      summary: `Merge pull request: ${t.title}`,
      content: { title: t.title, branch: r.branch ?? "", summary: r.summary ?? "", prUrl: r.prUrl ?? "" },
      previewUrl: r.previewUrl ?? r.prUrl ?? null,
      riskNote: "Code change on the DocLedger repo. Builder never merges: approve here, then merge on GitHub.",
      taskId,
      agentId: builder?.id ?? null,
      floorId: t.floorId,
    }, now);
    await db.update(tickets).set({ status: "pr_open", branch: r.branch ?? null, prUrl: r.prUrl ?? null, previewUrl: r.previewUrl ?? null, approvalId, costUsd: (r.usage?.costUsd ?? 0).toFixed(6), updatedAt: now }).where(eq(tickets.id, t.id));
    if (taskId) await db.update(tasks).set({ status: "done", output: { prUrl: r.prUrl, branch: r.branch, summary: r.summary, title: t.title }, reviewScore: 7, reviewReason: "Pull request opened, the owner reviews it", finishedAt: now, updatedAt: now }).where(eq(tasks.id, taskId));
    if (builder) await db.update(agents).set({ status: "idle", currentTaskId: null, tasksDone: builder.tasksDone + 1, updatedAt: now }).where(eq(agents.id, builder.id));
    await db.insert(taskEvents).values({ taskId, agentId: builder?.id ?? null, floorId: t.floorId, type: "done", message: `Pull request opened: ${t.title}`, data: { prUrl: r.prUrl }, createdAt: now });
  } else {
    await db.update(tickets).set({ status: "failed", failureReason: r.failureReason ?? "unknown", costUsd: (r.usage?.costUsd ?? 0).toFixed(6), updatedAt: now }).where(eq(tickets.id, t.id));
    if (taskId) await db.update(tasks).set({ status: "failed", blockedReason: r.failureReason ?? "unknown", finishedAt: now, updatedAt: now }).where(eq(tasks.id, taskId));
    if (builder) await db.update(agents).set({ status: "idle", currentTaskId: null, tasksFailed: builder.tasksFailed + 1, updatedAt: now }).where(eq(agents.id, builder.id));
    await db.insert(taskEvents).values({ taskId, agentId: builder?.id ?? null, floorId: t.floorId, type: "failed", message: `Builder stopped on ${t.title}: ${r.failureReason ?? "unknown"}`, createdAt: now });
  }
  return { ok: true };
}
