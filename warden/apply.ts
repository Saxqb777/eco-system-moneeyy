// Executes one Warden decision object. Every effect is a database change or an approval item, never an external call.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, floors, ideas, taskEvents, tasks, tickets } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { asNumber, getSettings, setSetting } from "@/lib/settings";
import { enqueueMessage } from "@/lib/telegram";
import type { WardenDecisions } from "./prompt";

export interface ApplySummary {
  assigned: number;
  accepted: number;
  rejected: number;
  notes: number;
  ideas: number;
  moves: number;
  approvals: number;
  messages: number;
  unblocked: number;
  skipped: string[];
}

const PENTHOUSE_LEVEL = 5;

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

export async function applyWardenDecisions(db: Db, runId: string, d: WardenDecisions, now = new Date()): Promise<ApplySummary> {
  const out: ApplySummary = { assigned: 0, accepted: 0, rejected: 0, notes: 0, ideas: 0, moves: 0, approvals: 0, messages: 0, unblocked: 0, skipped: [] };
  const floorRows = await db.select().from(floors);
  const agentRows = await db.select().from(agents);
  const floorById = new Map(floorRows.map((f) => [f.id, f]));
  const floorBySlug = new Map(floorRows.map((f) => [f.slug, f]));
  const agentBySlug = new Map(agentRows.map((a) => [a.slug, a]));
  const warden = agentRows.find((a) => a.kind === "warden");
  const wardenId = warden?.id ?? null;

  for (const a of d.assignments) {
    const agent = agentBySlug.get(a.agent);
    const floor = agent?.floorId ? floorById.get(agent.floorId) : undefined;
    if (!agent || agent.kind === "warden" || !floor) {
      out.skipped.push(`assignment to unknown worker ${a.agent}`);
      continue;
    }
    if (floor.status !== "live" || (floor.throttledUntil && floor.throttledUntil.getTime() > now.getTime())) {
      out.skipped.push(`assignment on ${floor.slug}: floor is ${floor.status !== "live" ? floor.status : "throttled"}`);
      continue;
    }
    const [queued] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.agentId, agent.id), eq(tasks.status, "queued"), eq(tasks.simulated, false))).limit(3);
    void queued;
    const [row] = await db
      .insert(tasks)
      .values({ floorId: floor.id, agentId: agent.id, kind: a.kind, title: a.title.slice(0, 60), status: "queued", priority: a.priority, input: a.input ? { instructions: a.input } : {}, simulated: false, createdAt: now, updatedAt: now })
      .returning({ id: tasks.id });
    await logEvent(db, { taskId: row?.id, agentId: agent.id, floorId: floor.id, type: "created", message: `${a.title} queued by Warden`, at: now });
    out.assigned += 1;
  }

  for (const r of d.reviews) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, r.taskId)).limit(1);
    if (!t || t.status !== "review") {
      out.skipped.push(`review of ${r.taskId}: not waiting for review`);
      continue;
    }
    const agent = t.agentId ? agentRows.find((x) => x.id === t.agentId) : undefined;
    const accept = r.decision === "accept" && r.score >= 6;
    await logEvent(db, { taskId: t.id, agentId: wardenId, floorId: t.floorId, type: "review", message: `Warden scored ${r.score}/10: ${r.reason}`, data: { score: r.score, reason: r.reason }, at: now });
    if (accept) {
      await db.update(tasks).set({ status: "done", reviewScore: r.score, reviewReason: r.reason, finishedAt: t.finishedAt ?? now, updatedAt: now }).where(eq(tasks.id, t.id));
      await logEvent(db, { taskId: t.id, agentId: t.agentId, floorId: t.floorId, type: "done", message: `${t.title} done`, at: now });
      out.accepted += 1;
    } else {
      await db.update(tasks).set({ status: "rejected", reviewScore: r.score, reviewReason: r.reason, finishedAt: t.finishedAt ?? now, updatedAt: now }).where(eq(tasks.id, t.id));
      await db.insert(tasks).values({ floorId: t.floorId, agentId: t.agentId, kind: t.kind, title: t.title, status: "queued", priority: 3, input: { ...((t.input ?? {}) as Record<string, unknown>), feedback: r.reason }, feedback: r.reason, parentTaskId: t.id, simulated: false, createdAt: now, updatedAt: now });
      await logEvent(db, { taskId: t.id, agentId: t.agentId, floorId: t.floorId, type: "rejected", message: "Rejected, sent back with feedback", at: now });
      out.rejected += 1;
    }
    if (agent) {
      await db
        .update(agents)
        .set({
          tasksDone: accept ? agent.tasksDone + 1 : agent.tasksDone,
          tasksFailed: accept ? agent.tasksFailed : agent.tasksFailed + 1,
          reviewScoreSum: (Number(agent.reviewScoreSum) + r.score).toFixed(2),
          reviewCount: agent.reviewCount + 1,
          status: agent.currentTaskId === t.id ? "idle" : agent.status,
          currentTaskId: agent.currentTaskId === t.id ? null : agent.currentTaskId,
          updatedAt: now,
        })
        .where(eq(agents.id, agent.id));
      agent.tasksDone = accept ? agent.tasksDone + 1 : agent.tasksDone;
      agent.tasksFailed = accept ? agent.tasksFailed : agent.tasksFailed + 1;
      agent.reviewScoreSum = (Number(agent.reviewScoreSum) + r.score).toFixed(2);
      agent.reviewCount += 1;
    }
  }

  for (const n of d.strategyNotes) {
    const floor = floorBySlug.get(n.floor);
    if (!floor) {
      out.skipped.push(`note for unknown floor ${n.floor}`);
      continue;
    }
    await db.update(floors).set({ strategyNote: n.note.slice(0, 400), strategyUpdatedAt: now, updatedAt: now }).where(eq(floors.id, floor.id));
    await logEvent(db, { agentId: wardenId, floorId: floor.id, type: "log", message: `Warden's note for ${floor.name}: ${n.note}`, at: now });
    out.notes += 1;
  }

  for (const i of d.ideaActions) {
    const [idea] = await db.select().from(ideas).where(eq(ideas.id, i.ideaId)).limit(1);
    if (!idea || idea.status !== "new") {
      out.skipped.push(`idea ${i.ideaId}: not new`);
      continue;
    }
    const floor = i.floor ? floorBySlug.get(i.floor) : undefined;
    let ticketId: string | null = null;
    if (i.action === "ticket") {
      const title = (i.ticketTitle || idea.text).slice(0, 80);
      if (floor?.slug === "docledger" || !floor) {
        const [tk] = await db.insert(tickets).values({ floorId: floor?.id ?? floorBySlug.get("docledger")?.id ?? null, source: "idea", title, description: idea.text, repo: "Saxqb777/docledger", status: "backlog", simulated: false, createdAt: now, updatedAt: now }).returning({ id: tickets.id });
        ticketId = tk?.id ?? null;
      } else if (floor.status === "live") {
        const worker = agentRows.find((a) => a.floorId === floor.id && a.kind === "worker");
        await db.insert(tasks).values({ floorId: floor.id, agentId: worker?.id ?? null, kind: "idea", title, status: "queued", priority: 4, input: { instructions: idea.text }, simulated: false, createdAt: now, updatedAt: now });
      }
    }
    await db
      .update(ideas)
      .set({ status: i.action === "ticket" ? "ticketed" : i.action === "decline" ? "declined" : "noted", floorId: floor?.id ?? null, ticketId, wardenReply: i.reply || null, handledAt: now })
      .where(eq(ideas.id, idea.id));
    if (i.reply) await enqueueMessage(db, { kind: "idea_reply", body: `Warden on your idea "${idea.text.slice(0, 80)}": ${i.reply}`, relatedType: "idea", relatedId: idea.id, now });
    out.ideas += 1;
  }

  if (d.budgetMoves.length) {
    const s = await getSettings(db);
    const guide = { ...((s.allocation_guide_usd ?? {}) as Record<string, number>) };
    for (const m of d.budgetMoves) {
      if (!(m.from in guide) || !(m.to in guide)) {
        out.skipped.push(`budget move ${m.from} to ${m.to}: unknown line`);
        continue;
      }
      const usd = Math.min(m.usd, asNumber(guide[m.from], 0));
      guide[m.from] = Math.round((asNumber(guide[m.from], 0) - usd) * 100) / 100;
      guide[m.to] = Math.round((asNumber(guide[m.to], 0) + usd) * 100) / 100;
      out.moves += 1;
    }
    await setSetting(db, "allocation_guide_usd", guide);
    if (out.moves) await logEvent(db, { agentId: wardenId, floorId: warden?.floorId ?? null, type: "log", message: `Warden moved the monthly guide: ${d.budgetMoves.map((m) => `${m.usd} USD from ${m.from} to ${m.to}`).join(", ")}`, at: now });
  }

  for (const a of d.approvalsToRaise) {
    const content: Record<string, unknown> = { text: a.content };
    if (a.type === "spend_increase") {
      const m = a.content.match(/(\d+(?:\.\d+)?)\s*USD/i);
      if (m) content.proposedCapUsd = Number(m[1]);
    }
    if (a.type === "decision" && /auto (approve|send)/i.test(a.summary + a.content)) {
      const slug = [...floorBySlug.keys()].find((k) => a.content.toLowerCase().includes(k) || a.summary.toLowerCase().includes(k)) ?? "deals";
      // DocLedger earns auto send through ten approvals in a row; the Tower raises that item itself, never Warden.
      if (slug === "docledger") {
        out.skipped.push("auto send for DocLedger is raised by the Tower at the trust point");
        continue;
      }
      content.autoApproveFloor = slug;
    }
    if (a.type === "floor_unlock") {
      const slug = [...floorBySlug.keys()].find((k) => a.content.toLowerCase().includes(k) || a.summary.toLowerCase().includes(k));
      if (slug) content.floor = slug;
    }
    await raiseApproval(db, { type: a.type, summary: a.summary.slice(0, 200), content, riskNote: a.riskNote || null, agentId: wardenId, floorId: warden?.floorId ?? null }, now);
    out.approvals += 1;
  }

  if (d.messagesToOwner.length) {
    await enqueueMessage(db, { kind: "warden_note", body: `Warden: ${d.messagesToOwner.join("\n")}`, now });
    out.messages += d.messagesToOwner.length;
  }

  for (const b of d.blockedResolutions) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, b.taskId)).limit(1);
    if (!t || t.status !== "blocked") {
      out.skipped.push(`blocked task ${b.taskId}: not blocked`);
      continue;
    }
    const worker = t.agentId ? agentRows.find((x) => x.id === t.agentId) : undefined;
    if (b.action === "ask_owner") {
      await db.update(tasks).set({ needsOwner: true, updatedAt: now }).where(eq(tasks.id, t.id));
      await raiseApproval(db, { type: "decision", summary: `${worker?.name ?? "A worker"} needs you: ${t.blockedReason ?? b.reason}`, content: { text: b.reason, task: t.title }, riskNote: "Approve to send the task back to the queue with your note, reject to drop it with feedback.", taskId: t.id, agentId: t.agentId, floorId: t.floorId }, now);
      await logEvent(db, { taskId: t.id, agentId: wardenId, floorId: t.floorId, type: "log", message: `Warden asked the owner: ${b.reason}`, at: now });
    } else {
      const target = b.action === "reassign" ? agentBySlug.get(b.agent) : worker;
      if (!target || target.kind === "warden") {
        out.skipped.push(`reassign ${b.taskId}: unknown worker ${b.agent}`);
        continue;
      }
      const input = { ...((t.input ?? {}) as Record<string, unknown>), ...(b.input ? { wardenInput: b.input } : {}) };
      await db.update(tasks).set({ agentId: target.id, status: "queued", blockedReason: null, needsOwner: false, input, updatedAt: now }).where(eq(tasks.id, t.id));
      if (worker) await db.update(agents).set({ status: "idle", currentTaskId: null, updatedAt: now }).where(eq(agents.id, worker.id));
      await logEvent(db, { taskId: t.id, agentId: wardenId, floorId: t.floorId, type: "warden_arrived", message: `Warden unblocked ${worker?.name ?? "the task"}: ${b.reason}`, at: now });
    }
    out.unblocked += 1;
  }

  if (warden && warden.status === "helping") {
    await db.update(agents).set({ status: "idle", locationLevel: PENTHOUSE_LEVEL, updatedAt: now }).where(eq(agents.id, warden.id));
    await logEvent(db, { agentId: warden.id, floorId: warden.floorId, type: "log", message: "Warden went back up to the Penthouse", data: { from: warden.locationLevel, to: PENTHOUSE_LEVEL }, at: now });
  }
  await logEvent(db, { agentId: wardenId, floorId: warden?.floorId ?? null, type: "log", message: `Warden run: ${d.summary}`, data: { runId, ...out, skipped: out.skipped.length }, at: now });
  return out;
}
