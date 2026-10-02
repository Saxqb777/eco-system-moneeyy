// Moves the live floors along every tick: the day's tasks, replies to chase, approved emails to send,
// reviews that waited too long, and floor unlock rules.
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, approvals, floors, leads, outreach, taskEvents, tasks } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { getSpendSummary } from "@/lib/budget";
import { asNumber, getSettings, setSetting } from "@/lib/settings";
import { dubaiDayStartUtc, dubaiParts } from "@/lib/time";
import { FOLLOW_UP_LADDER } from "@/config/docledger";
import { maybeSendCallSheet } from "@/lib/callsheet";
import { clearSnooze, maybeRaiseAutoSend, snoozedUntil } from "./docledger-autonomy";
import { openTasksOfKind } from "./playbooks";

export interface AdvanceSummary {
  status: string;
  created: Record<string, number>;
  executed: number;
  deferred: string[];
  autoAccepted: number;
  unlocksRaised: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
// D077: emails leave at most two per heartbeat and 25 a day (settings.docledger_daily_send_cap), so a day's sends
// spread over the readers' working hours instead of leaving in one burst. The owner's own /send is never held.
export const EMAILS_PER_TICK = 2;
export const DAILY_SEND_CAP = 25;
// A company that opened its demo and stayed quiet gets one nudge, after this long.
const NUDGE_AFTER_MS = 20 * 3600_000;

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

async function queueTask(db: Db, floorId: string, agentId: string, kind: string, title: string, input: Record<string, unknown>, priority: number, now: Date) {
  const [row] = await db.insert(tasks).values({ floorId, agentId, kind, title: title.slice(0, 60), status: "queued", priority, input, simulated: false, createdAt: now, updatedAt: now }).returning({ id: tasks.id });
  await logEvent(db, { taskId: row?.id, agentId, floorId, type: "created", message: `${title} queued`, at: now });
}

async function hasOpenTaskFor(db: Db, kind: string, field: string, value: string, statuses = ["queued", "running", "review"]): Promise<boolean> {
  const [r] = await db
    .select({ n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.kind, kind), eq(tasks.simulated, false), inArray(tasks.status, statuses), sql`${tasks.input} ->> ${field} = ${value}`));
  return Number(r?.n ?? 0) > 0;
}

// DocLedger Sales: Scout in the morning, Analyst on new leads, Writer on qualified ones, Chaser on the threads.
async function advanceDocLedger(db: Db, now: Date, created: Record<string, number>) {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  if (!floor || floor.status !== "live") return;
  // Replies whose text the webhook did not carry are read by id before the Chaser sees them (D077).
  {
    const { repairBlankReplies } = await import("@/lib/email");
    const r = await repairBlankReplies(db, now);
    if (r.repaired) created.replies_read = (created.replies_read ?? 0) + r.repaired;
  }
  const crew = await db.select().from(agents).where(eq(agents.floorId, floor.id));
  const bySlug = new Map(crew.map((a) => [a.slug, a]));
  const scout = bySlug.get("docledger_scout");
  const analyst = bySlug.get("docledger_analyst");
  const writer = bySlug.get("docledger_writer");
  const chaser = bySlug.get("docledger_chaser");
  const p = dubaiParts(now);
  const settingsMap = await getSettings(db);
  const dayDone = settingsMap.pipeline_day_docledger === p.dayKey;

  if (p.hour >= 7 && !dayDone) {
    if (scout && (await openTasksOfKind(db, scout.id, "find_leads")) === 0) {
      await queueTask(db, floor.id, scout.id, "find_leads", "Find freight forwarders", { instructions: floor.strategyNote ?? "" }, 5, now);
      created.find_leads = (created.find_leads ?? 0) + 1;
    }
    await setSetting(db, "pipeline_day_docledger", p.dayKey);
  }

  if (analyst) {
    const fresh = await db.select().from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "new"))).orderBy(asc(leads.createdAt)).limit(5);
    for (const lead of fresh) {
      if (await hasOpenTaskFor(db, "qualify_lead", "leadId", lead.id)) continue;
      await queueTask(db, floor.id, analyst.id, "qualify_lead", `Qualify ${lead.company}`, { leadId: lead.id }, 5, now);
      created.qualify_lead = (created.qualify_lead ?? 0) + 1;
    }
    // D079: no second look. The Tower read the site itself before the first look; a good fit with no address
    // and a phone number goes on the owner's call sheet instead.
  }

  if (writer) {
    const qualified = await db.select().from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "qualified"))).orderBy(desc(leads.score)).limit(5);
    for (const lead of qualified) {
      if (await hasOpenTaskFor(db, "draft_outreach", "leadId", lead.id)) continue;
      const [existing] = await db.select({ id: outreach.id }).from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).limit(1);
      if (existing) continue;
      await queueTask(db, floor.id, writer.id, "draft_outreach", `Draft outreach email`, { leadId: lead.id }, 4, now);
      created.draft_outreach = (created.draft_outreach ?? 0) + 1;
    }
  }

  // Trust point: after ten approvals in a row the Tower asks once to send routine emails on their own.
  await maybeRaiseAutoSend(db, floor, now);

  if (chaser) {
    const replied = await db.select().from(outreach).where(and(eq(outreach.simulated, false), eq(outreach.status, "replied"))).orderBy(asc(outreach.replyAt)).limit(5);
    for (const o of replied) {
      if (await hasOpenTaskFor(db, "follow_up", "outreachId", o.id)) continue;
      await db.update(outreach).set({ status: "handling", updatedAt: now }).where(eq(outreach.id, o.id));
      await queueTask(db, floor.id, chaser.id, "follow_up", "Chase warm reply", { outreachId: o.id, mode: "reply" }, 2, now);
      created.follow_up = (created.follow_up ?? 0) + 1;
    }
    // Leads that said not now, or were away, get a check in when their pause ends.
    const waking = await db
      .select()
      .from(leads)
      .where(and(eq(leads.simulated, false), sql`${leads.status} not in ('lost', 'client')`, sql`(${leads.decisionMaker} ->> 'snoozeUntil') is not null`, sql`(${leads.decisionMaker} ->> 'snoozeUntil')::timestamptz <= ${now}`))
      .limit(3);
    for (const lead of waking) {
      const [last] = await db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(desc(outreach.step)).limit(1);
      await clearSnooze(db, lead, now);
      if (!last || (await hasOpenTaskFor(db, "follow_up", "outreachId", last.id))) continue;
      await queueTask(db, floor.id, chaser.id, "follow_up", `Check back in with ${lead.company}`, { outreachId: last.id, mode: "check_in" }, 3, now);
      created.follow_up = (created.follow_up ?? 0) + 1;
    }
    // D077: a company that opened the demo made for them and stayed quiet gets one short nudge, a day later.
    const visited = await db
      .select()
      .from(leads)
      .where(and(eq(leads.simulated, false), eq(leads.status, "contacted"), isNotNull(leads.demoVisitedAt), lt(leads.demoVisitedAt, new Date(now.getTime() - NUDGE_AFTER_MS)), gt(leads.demoVisitedAt, new Date(now.getTime() - 5 * DAY_MS))))
      .limit(3);
    for (const lead of visited) {
      const [last] = await db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false), eq(outreach.status, "sent"))).orderBy(desc(outreach.step)).limit(1);
      if (!last || last.step >= 3) continue;
      const [later] = await db.select({ id: outreach.id }).from(outreach).where(and(eq(outreach.leadId, lead.id), sql`${outreach.step} > ${last.step}`)).limit(1);
      if (later) continue;
      if (await hasOpenTaskFor(db, "follow_up", "outreachId", last.id, ["queued", "running", "review", "done", "blocked"])) continue;
      await queueTask(db, floor.id, chaser.id, "follow_up", `Nudge ${lead.company} after their demo visit`, { outreachId: last.id, mode: "nudge" }, 2, now);
      created.follow_up = (created.follow_up ?? 0) + 1;
    }
    // D079: the ladder. Day 3, then 4, 7 and 7 more, one angle each, the fifth email the last.
    const maxStep = Math.max(...FOLLOW_UP_LADDER.map((r) => r.step));
    const minWait = Math.min(...FOLLOW_UP_LADDER.map((r) => r.afterDays));
    const stale = await db
      .select()
      .from(outreach)
      .where(and(eq(outreach.simulated, false), eq(outreach.status, "sent"), lt(outreach.step, maxStep), lt(outreach.sentAt, new Date(now.getTime() - minWait * DAY_MS)), isNull(outreach.replyText)))
      .orderBy(asc(outreach.sentAt))
      .limit(6);
    for (const o of stale) {
      if (!o.leadId) continue;
      const rung = FOLLOW_UP_LADDER.find((r) => r.step === o.step + 1);
      if (!rung || !o.sentAt || now.getTime() - o.sentAt.getTime() < rung.afterDays * DAY_MS) continue;
      const [later] = await db.select({ id: outreach.id }).from(outreach).where(and(eq(outreach.leadId, o.leadId), sql`${outreach.step} > ${o.step}`)).limit(1);
      if (later) continue;
      const [lead] = await db.select().from(leads).where(eq(leads.id, o.leadId)).limit(1);
      // Customers in their free month hear from Success, not from sales follow ups.
      if (!lead || lead.status === "lost" || lead.status === "client" || lead.status === "trial") continue;
      const until = snoozedUntil(lead);
      if (until && until.getTime() > now.getTime()) continue;
      if (await hasOpenTaskFor(db, "follow_up", "outreachId", o.id)) continue;
      await queueTask(db, floor.id, chaser.id, "follow_up", rung.last ? `Last email to ${lead.company}` : `Send follow up ${rung.step}`, { outreachId: o.id, mode: "follow_up" }, 4, now);
      created.follow_up = (created.follow_up ?? 0) + 1;
    }
    // D079: the owner called and they were interested: the Chaser writes the email after the call, for him to approve.
    const hotCalls = await db.select().from(leads).where(and(eq(leads.simulated, false), sql`(${leads.decisionMaker} ->> 'hotFromCall') is not null`)).limit(3);
    for (const lead of hotCalls) {
      if (await hasOpenTaskFor(db, "follow_up", "leadId", lead.id, ["queued", "running", "review"])) continue;
      const [last] = await db.select({ id: outreach.id }).from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(desc(outreach.step)).limit(1);
      await queueTask(db, floor.id, chaser.id, "follow_up", `Email ${lead.company} after the call`, { leadId: lead.id, outreachId: last?.id ?? "", mode: "after_call" }, 1, now);
      created.follow_up = (created.follow_up ?? 0) + 1;
    }
  }
  // D079: the owner's call sheet, once a day at 10:00 Dubai.
  if (await maybeSendCallSheet(db, now)) created.call_sheet = 1;
}

// Approved items whose side effect could not run yet (for example Resend not on the clipboard) get another go.
async function executeApproved(db: Db, now: Date): Promise<{ executed: number; deferred: string[] }> {
  const rows = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.status, "approved"), eq(approvals.simulated, false), isNull(approvals.executedAt), inArray(approvals.type, ["outreach_email", "public_post"])))
    // A deferred item gets its updatedAt bumped, so it moves to the back: one item that cannot run never blocks the rest.
    .orderBy(asc(approvals.updatedAt))
    .limit(10);
  let executed = 0;
  const deferred: string[] = [];
  const settingsMap = await getSettings(db);
  const dailyCap = Math.max(0, Math.floor(asNumber(settingsMap.docledger_daily_send_cap, DAILY_SEND_CAP)));
  const [sentRow] = await db.select({ n: sql<string>`count(*)` }).from(outreach).where(and(eq(outreach.simulated, false), gte(outreach.sentAt, dubaiDayStartUtc(now))));
  let sentToday = Number(sentRow?.n ?? 0);
  let sentThisTick = 0;
  for (const a of rows) {
    let result: { ok: boolean; error?: string; skipped?: string } = { ok: false, error: "no executor" };
    if (a.type === "outreach_email") {
      const { sendOutreach } = await import("@/lib/email");
      // The owner's own words go out at any hour and are never held; the workers' emails wait for the reader's
      // working day and leave a few at a time (D077).
      const ownerSent = (a.content as Record<string, unknown> | null)?.ownerSent === true;
      if (!ownerSent && sentToday >= dailyCap) result = { ok: false, error: `daily send cap of ${dailyCap} reached, the rest go tomorrow` };
      else if (!ownerSent && sentThisTick >= EMAILS_PER_TICK) result = { ok: false, error: "spread over the day: the next heartbeat sends more" };
      else {
        result = await sendOutreach(db, a, now, { anyHour: ownerSent });
        if (result.ok && !result.skipped && !ownerSent) {
          sentToday += 1;
          sentThisTick += 1;
        }
      }
    } else if (a.type === "public_post") {
      if ((a.content as Record<string, unknown> | null)?.social === "facebook") {
        const { publishSocial } = await import("@/agents/social");
        result = await publishSocial(db, a, now);
      } else {
        const { publishPost } = await import("@/agents/deals");
        result = await publishPost(db, a, now);
      }
    }
    if (result.ok) {
      await db.update(approvals).set({ executedAt: now, executionResult: result.skipped ? { ok: true, skipped: result.skipped } : { ok: true }, updatedAt: now }).where(eq(approvals.id, a.id));
      if (!result.skipped) executed += 1;
    } else {
      await db.update(approvals).set({ executionResult: { deferred: result.error ?? "unknown" }, updatedAt: now }).where(eq(approvals.id, a.id));
      if (result.error && !deferred.includes(result.error)) deferred.push(result.error);
    }
  }
  return { executed, deferred };
}

// A review Warden did not get to within a day is accepted with a middling score so the floor keeps moving.
async function acceptStaleReviews(db: Db, now: Date): Promise<number> {
  const stale = await db.select().from(tasks).where(and(eq(tasks.status, "review"), eq(tasks.simulated, false), lt(tasks.finishedAt, new Date(now.getTime() - DAY_MS)))).limit(20);
  for (const t of stale) {
    await db.update(tasks).set({ status: "done", reviewScore: 6, reviewReason: "Accepted after a day without a Warden review", updatedAt: now }).where(eq(tasks.id, t.id));
    if (t.agentId) await db.update(agents).set({ tasksDone: sql`${agents.tasksDone} + 1`, reviewScoreSum: sql`${agents.reviewScoreSum} + 6`, reviewCount: sql`${agents.reviewCount} + 1`, updatedAt: now }).where(eq(agents.id, t.agentId));
    await logEvent(db, { taskId: t.id, agentId: t.agentId, floorId: t.floorId, type: "done", message: `${t.title} accepted after a day without a Warden review`, at: now });
  }
  return stale.length;
}

// Unlock rules from the brief become floor_unlock approval items, raised once each.
async function checkUnlocks(db: Db, now: Date): Promise<string[]> {
  const settingsMap = await getSettings(db);
  const level = asNumber(settingsMap.budget_level, 1);
  const raised: string[] = [];
  if (level < 2) return raised;
  const spend = await getSpendSummary(db, false, now);
  const locked = await db.select().from(floors).where(eq(floors.status, "locked"));
  for (const f of locked) {
    const marker = `unlock_asked_${f.slug}`;
    if (settingsMap[marker]) continue;
    let ok = false;
    if (f.slug === "content") ok = spend.netUsd > 100;
    if (f.slug === "service") {
      const [demo] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.simulated, false), inArray(leads.status, ["demo_booked", "client"]))).limit(1);
      ok = !!demo;
    }
    if (!ok) continue;
    await raiseApproval(db, { type: "floor_unlock", summary: `Unlock ${f.name}`, content: { floor: f.slug, rule: f.unlockRule }, riskNote: `${f.unlockRule ?? "Rule met"}. Approving opens the floor; its workers still need defining.`, floorId: f.id }, now);
    await setSetting(db, marker, now.toISOString());
    raised.push(f.slug);
  }
  return raised;
}

export async function advancePipelines(db: Db, now = new Date()): Promise<AdvanceSummary> {
  const created: Record<string, number> = {};
  await advanceDocLedger(db, now, created);
  try {
    const { advanceGrowth } = await import("@/agents/growth");
    await advanceGrowth(db, now, created);
  } catch (err) {
    created.growth_error = 1;
    console.error("growth floor failed", err instanceof Error ? err.message : err);
  }
  try {
    const { advanceDeals } = await import("@/agents/deals");
    await advanceDeals(db, now, created);
  } catch (err) {
    created.deals_error = 1;
    void err;
  }
  const { executed, deferred } = await executeApproved(db, now);
  const autoAccepted = await acceptStaleReviews(db, now);
  const unlocksRaised = await checkUnlocks(db, now);
  return { status: "ok", created, executed, deferred, autoAccepted, unlocksRaised };
}

export { gte };
