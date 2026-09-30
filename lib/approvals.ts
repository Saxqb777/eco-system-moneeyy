// The approval queue. One table, one panel, one Telegram flow. Every side effect checks an approved row first.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, floors, leads, outreach, posts, taskEvents, tasks, tickets } from "@/db/schema";
import { enqueueMessage } from "@/lib/telegram";
import { asNumber, getSettings, setSetting } from "@/lib/settings";

export type ApprovalType = "outreach_email" | "public_post" | "pull_request" | "spend_increase" | "floor_unlock" | "credential_request" | "decision";

export interface RaiseApprovalInput {
  type: ApprovalType;
  summary: string;
  content?: Record<string, unknown>;
  previewUrl?: string | null;
  riskNote?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  floorId?: string | null;
  simulated?: boolean;
  autoApproved?: boolean; // a floor rule Saaqib approved earlier (Deals Engine after 14 days)
}

// Creates the row and, for real items, rings the red phone on Telegram with inline buttons.
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n).trimEnd()} [cut, full text in the game]` : v);

// What exactly the owner is approving, so a tap on the phone is an informed one: the email itself, the post
// itself, or the decision's own words. A hot reply's words and answer come in their own message right after.
export function approvalDetail(type: ApprovalType, content: Record<string, unknown>): string {
  if (type === "outreach_email") {
    if (content.hot === true) return "Their words and the suggested answer come in the next message.";
    const to = [str(content.toName), str(content.to) ? `<${str(content.to)}>` : ""].filter(Boolean).join(" ");
    const lines = [`To: ${to || "no address yet"}${str(content.company) ? `, ${str(content.company)}` : ""}`];
    if (str(content.subject)) lines.push(`Subject: ${str(content.subject)}`);
    if (str(content.body)) lines.push("", clip(str(content.body), 2200));
    return lines.join("\n");
  }
  if (type === "public_post") {
    const poll = content.poll as { question?: string; options?: string[] } | null | undefined;
    if (poll?.question) return `Poll: ${poll.question}\n${(poll.options ?? []).map((o) => `  ${o}`).join("\n")}`;
    return str(content.body) ? `Post:\n${clip(str(content.body), 1800)}` : "";
  }
  if (type === "decision" || type === "spend_increase") return clip(str(content.text), 1200);
  return "";
}

export async function raiseApproval(db: Db, input: RaiseApprovalInput, now = new Date()): Promise<{ id: string }> {
  const [row] = await db
    .insert(approvals)
    .values({
      type: input.type,
      status: "pending",
      summary: input.summary,
      content: input.content ?? {},
      previewUrl: input.previewUrl ?? null,
      riskNote: input.riskNote ?? null,
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      floorId: input.floorId ?? null,
      simulated: input.simulated ?? false,
      ...(input.autoApproved ? { status: "approved", decidedAt: now, decidedVia: "auto" } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: approvals.id });
  const id = row?.id ?? "";
  if (!input.simulated && id && !input.autoApproved) {
    const lines = [`Approval needed: ${input.summary}`];
    const detail = approvalDetail(input.type, input.content ?? {});
    if (detail) lines.push("", detail, "");
    if (input.riskNote) lines.push(`Risk: ${input.riskNote}`);
    if (input.previewUrl) lines.push(`Preview: ${input.previewUrl}`);
    lines.push("Reject asks for one line of feedback.");
    await enqueueMessage(db, {
      kind: "approval",
      body: lines.join("\n"),
      inlineKeyboard: [[{ text: "Approve", callback_data: `ap:${id}:a` }, { text: "Reject", callback_data: `ap:${id}:r` }]],
      relatedType: "approval",
      relatedId: id,
      now,
    });
  }
  return { id };
}

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

// Real side effects that code can run on approval today. Phases 5 and 6 add email, posts and pull requests.
async function executeApproval(db: Db, a: typeof approvals.$inferSelect, now: Date): Promise<Record<string, unknown>> {
  const content = (a.content ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case "spend_increase": {
      const s = await getSettings(db);
      const ceiling = asNumber(content.proposedCeilingUsd, asNumber(s.hard_ceiling_usd, 5));
      const cap = content.proposedCapUsd !== undefined ? Math.min(asNumber(content.proposedCapUsd, 0), ceiling) : Math.min(asNumber(s.daily_cap_usd, 1.7), ceiling);
      await setSetting(db, "hard_ceiling_usd", ceiling);
      await setSetting(db, "daily_cap_usd", cap);
      return { hardCeilingUsd: ceiling, dailyCapUsd: cap };
    }
    case "floor_unlock": {
      const slug = String(content.floor ?? "");
      if (slug) await db.update(floors).set({ status: "live", updatedAt: now }).where(eq(floors.slug, slug));
      return { floor: slug, status: "live" };
    }
    case "decision": {
      // A growth idea the Head of Growth brought: it becomes an experiment the team follows (D065).
      if (content.growthIdea && typeof content.growthIdea === "object") {
        const { onIdeaApproved } = await import("@/agents/growth");
        return onIdeaApproved(db, a, now);
      }
      // A Builder ticket Product proposed: it joins tonight's backlog.
      if (typeof content.ticketId === "string") {
        const { onTicketDecided } = await import("@/agents/growth");
        await onTicketDecided(db, content.ticketId, true, now);
        return { ticketId: content.ticketId, status: "backlog" };
      }
      // Social earned the owner's trust: it posts on the DocLedger Facebook Page on its own from now on (D074).
      if (content.socialAutoPost === true) {
        const { setAutoPost } = await import("@/agents/social");
        await setAutoPost(db, true, now);
        return { socialAutoPost: true };
      }
      // A floor rule: Warden asked to auto approve a floor's public posts (Deals Engine after 14 days).
      if (typeof content.autoApproveFloor === "string") {
        await db.update(floors).set({ autoApprove: true, autoApproveSince: now, updatedAt: now }).where(eq(floors.slug, content.autoApproveFloor));
        return { autoApproveFloor: content.autoApproveFloor };
      }
      // A blocked task waits on the owner. The answer becomes task input and the task goes back in the queue.
      if (a.taskId) {
        const [t] = await db.select().from(tasks).where(eq(tasks.id, a.taskId)).limit(1);
        if (t && t.status === "blocked") {
          const input = { ...((t.input ?? {}) as Record<string, unknown>), ownerDecision: "approved", ownerNote: a.feedback ?? null };
          await db.update(tasks).set({ status: "queued", blockedReason: null, needsOwner: false, input, updatedAt: now }).where(eq(tasks.id, t.id));
        }
      }
      return { requeued: !!a.taskId };
    }
    case "outreach_email": {
      const { sendOutreach } = await import("@/lib/email");
      const r = await sendOutreach(db, { ...a, status: "approved" }, now);
      return r.ok ? { sent: true } : { deferred: r.error ?? "send failed" };
    }
    case "public_post": {
      // The DocLedger Facebook Page (D074) or the Deals channel.
      if (content.social === "facebook") {
        const { publishSocial } = await import("@/agents/social");
        const r = await publishSocial(db, { ...a, status: "approved" }, now);
        return r.ok ? { posted: true } : { deferred: r.error ?? "post failed" };
      }
      const { publishPost } = await import("@/agents/deals");
      const r = await publishPost(db, { ...a, status: "approved" }, now);
      return r.ok ? { posted: true } : { deferred: r.error ?? "post failed" };
    }
    case "pull_request": {
      // Builder never merges. Approved means Saaqib merges it himself on GitHub.
      await db.update(tickets).set({ status: "approved", updatedAt: now }).where(eq(tickets.approvalId, a.id));
      return { note: "Approved. Merge it on GitHub when you are ready, Builder never merges." };
    }
    default:
      return { deferred: "executed by the floor pipeline" };
  }
}

// Shared by the panel, Telegram and the simulation: records the decision and moves the linked row along.
export async function applyApprovalDecision(db: Db, approvalId: string, status: "approved" | "rejected", feedback: string | null, via: string, now = new Date()) {
  const [a] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  if (!a || a.status !== "pending") return null;
  let executionResult: Record<string, unknown> | null = null;
  let executedAt: Date | null = null;
  if (a.simulated) {
    executedAt = now;
    executionResult = { simulated: true };
    if (a.type === "outreach_email") {
      await db.update(outreach).set({ status: status === "approved" ? "sent" : "rejected", sentAt: status === "approved" ? now : null, updatedAt: now }).where(eq(outreach.approvalId, a.id));
      const [o] = await db.select().from(outreach).where(eq(outreach.approvalId, a.id)).limit(1);
      if (o?.leadId) await db.update(leads).set({ status: status === "approved" ? "contacted" : "qualified", updatedAt: now }).where(eq(leads.id, o.leadId));
    } else if (a.type === "public_post") {
      await db.update(posts).set({ status: status === "approved" ? "approved" : "rejected", updatedAt: now }).where(eq(posts.approvalId, a.id));
    } else if (a.type === "pull_request") {
      await db.update(tickets).set({ status: status === "approved" ? "approved" : "rejected", updatedAt: now }).where(eq(tickets.approvalId, a.id));
    }
  } else if (status === "approved") {
    executionResult = await executeApproval(db, { ...a, feedback }, now);
    executedAt = executionResult.deferred ? null : now;
  } else if (a.type === "decision" && typeof (a.content as Record<string, unknown> | null)?.ticketId === "string") {
    const { onTicketDecided } = await import("@/agents/growth");
    await onTicketDecided(db, String((a.content as Record<string, unknown>).ticketId), false, now);
  } else if (a.taskId) {
    // Rejected: the owning task goes back to the worker with the feedback attached.
    const [t] = await db.select().from(tasks).where(eq(tasks.id, a.taskId)).limit(1);
    if (t && (t.status === "blocked" || t.status === "waiting_approval" || t.status === "done")) {
      await db.insert(tasks).values({ floorId: t.floorId, agentId: t.agentId, kind: t.kind, title: t.title, status: "queued", priority: 3, input: { ...((t.input ?? {}) as Record<string, unknown>), feedback }, feedback, parentTaskId: t.id, simulated: false, createdAt: now, updatedAt: now });
      if (t.status === "blocked") await db.update(tasks).set({ status: "rejected", updatedAt: now }).where(eq(tasks.id, t.id));
    }
  }
  await db
    .update(approvals)
    .set({ status, feedback, decidedAt: now, decidedVia: via, executedAt, executionResult, updatedAt: now })
    .where(eq(approvals.id, a.id));
  if (a.taskId) {
    await logEvent(db, { taskId: a.taskId, agentId: a.agentId, floorId: a.floorId, type: status === "approved" ? "log" : "rejected", message: status === "approved" ? `Approved by owner (${via})` : `Rejected by owner: ${feedback ?? "no feedback"}`, at: now });
  }
  if (!a.simulated && via !== "telegram") {
    await enqueueMessage(db, { kind: "approval_decided", body: `${status === "approved" ? "Approved" : "Rejected"} in the game: ${a.summary}${feedback ? `\nFeedback: ${feedback}` : ""}`, relatedType: "approval", relatedId: a.id, now });
  }
  return { id: a.id, status };
}
