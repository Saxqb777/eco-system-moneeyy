import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { collectBatches } from "@/agents/batches";
import { getDb } from "@/db/client";
import { approvals, ticks } from "@/db/schema";
import { buildBrief, formatBrief } from "@/lib/brief";
import { guardSpend, reviewBudget } from "@/lib/budget";
import { asBool, asNumber, getSettings, setSetting } from "@/lib/settings";
import { deliverMessages, ensureWebhook, getTelegramConfig } from "@/lib/telegram";
import { dubaiParts } from "@/lib/time";
import { runSimulation } from "@/sim/generator";
import { handleWardenBatchResult, runWarden, scheduledRunExists } from "@/warden/decide";
import { expressActive } from "@/agents/workers";
import { HEARTBEAT_GAP_MS, acquireTickLock, heartbeatDue, lastScheduledTickAt, releaseTickLock, type HeartbeatSource } from "@/warden/heartbeat";

export type TickTrigger = "cron" | "manual" | "setup" | "idea" | "blocked" | "ui";

export interface TickResult {
  id: string;
  trigger: TickTrigger;
  startedAt: string;
  finishedAt: string;
  steps: Record<string, unknown>;
  // Set when no tick ran: another one was running, or a scheduled one ran moments ago.
  skipped?: "busy" | "fresh";
}

export interface TickOptions {
  // Who knocked, kept on the tick row for diagnosis.
  via?: HeartbeatSource | string;
  // Scheduled knocks skip when a scheduled tick started less than this long ago.
  minGapMs?: number;
}

// Handlers for batch results by custom id prefix. worker outputs use "task_".
type ResultHandler = Parameters<typeof collectBatches>[2];

export function batchResultHandler(): ResultHandler {
  return async (r) => {
    const db = getDb();
    if (r.customId.startsWith("warden_")) await handleWardenBatchResult(db, r);
    else if (r.customId.startsWith("task_")) {
      const { handleTaskBatchResult } = await import("@/agents/workers");
      await handleTaskBatchResult(db, r);
    }
  };
}

function skippedTick(trigger: TickTrigger, now: Date, skipped: "busy" | "fresh"): TickResult {
  return { id: "", trigger, startedAt: now.toISOString(), finishedAt: new Date().toISOString(), steps: {}, skipped };
}

// The heartbeat. Every step is bounded and idempotent, so a late or repeated tick is harmless.
// One tick at a time: a second knock while one runs returns "busy" instead of doing the work twice.
export async function runTick(trigger: TickTrigger, now = new Date(), opts: TickOptions = {}): Promise<TickResult> {
  const db = getDb();
  const holder = randomUUID();
  if (!(await acquireTickLock(db, holder, now))) return skippedTick(trigger, now, "busy");
  try {
    if (opts.minGapMs && !heartbeatDue(await lastScheduledTickAt(db), now, opts.minGapMs)) return skippedTick(trigger, now, "fresh");
    return await tickBody(db, trigger, now, opts);
  } finally {
    await releaseTickLock(db, holder).catch(() => undefined);
  }
}

// A scheduled knock from any clock: runs a tick only when the last scheduled one is older than the gap.
export async function heartbeatIfDue(via: HeartbeatSource, now = new Date()): Promise<TickResult | null> {
  if (!heartbeatDue(await lastScheduledTickAt(getDb()), now)) return null;
  return runTick("cron", now, { via, minGapMs: HEARTBEAT_GAP_MS });
}

async function tickBody(db: ReturnType<typeof getDb>, trigger: TickTrigger, now: Date, opts: TickOptions): Promise<TickResult> {
  const [row] = await db.insert(ticks).values({ trigger, status: "running", startedAt: now }).returning({ id: ticks.id });
  const tickId = row?.id ?? "";
  const steps: Record<string, unknown> = opts.via ? { via: opts.via } : {};

  try {
    const settingsMap = await getSettings(db);
    const simulation = asBool(settingsMap.simulation_mode, true);
    const p = dubaiParts(now);

    // 1. Collect: ended batches come back, outputs and costs are written, Warden decisions apply.
    if (simulation) steps.collect = { status: "skipped", reason: "simulation mode" };
    else {
      try {
        steps.collect = await collectBatches(db, now, batchResultHandler());
      } catch (err) {
        steps.collect = { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 2. Advance: pipelines move tasks along (Phase 5).
    if (simulation) steps.advance = { status: "skipped", reason: "simulation mode" };
    else {
      try {
        const { advancePipelines } = await import("@/agents/pipeline");
        steps.advance = await advancePipelines(db, now);
      } catch (err) {
        steps.advance = { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 3. Guard: never past the cap, throttle a floor above 40 percent on its own.
    steps.guard = await guardSpend(db, now);

    // 4. Budget level review every 7 days from launch.
    steps.review = simulation ? { status: "skipped", reason: "simulation mode" } : await reviewBudget(db, now);

    // 5. Warden: scheduled batch runs, instant sync runs on the owner's actions.
    if (simulation) {
      steps.warden = { status: "simulated" };
    } else if (trigger === "manual" || trigger === "setup" || trigger === "idea" || trigger === "blocked") {
      steps.warden = await runWarden(db, { mode: "sync", trigger, now });
    } else if (trigger === "cron") {
      const interval = Math.max(1, asNumber(settingsMap.warden_interval_hours, 4));
      const due = p.hour % interval === 0 && p.minute < 25;
      const slotStart = new Date(now.getTime() - interval * 60 * 60 * 1000 + 30 * 60 * 1000);
      if (!due) steps.warden = { status: "not due", nextAt: `every ${interval} h on the hour, Dubai time` };
      else if (await scheduledRunExists(db, slotStart)) steps.warden = { status: "already ran this slot" };
      else steps.warden = await runWarden(db, { mode: expressActive(settingsMap, now) ? "sync" : "batch", trigger: "schedule", now });
    } else {
      steps.warden = { status: "skipped", reason: `trigger ${trigger} does not run Warden` };
    }

    // 6. Submit: queued worker tasks become one batch inside the remaining floor budget (Phase 5).
    if (simulation) steps.submit = { status: "skipped", reason: "simulation mode" };
    else {
      try {
        const { submitQueuedTasks } = await import("@/agents/workers");
        steps.submit = await submitQueuedTasks(db, now);
      } catch (err) {
        steps.submit = { status: "failed", error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 7. Deliver: the morning brief once a day from 08:00 Dubai, then the outbound queue.
    const briefHour = asNumber(settingsMap.brief_hour_local, 8);
    const briefSent = settingsMap.brief_sent_day as string | null;
    let briefStatus = "not due";
    if (p.hour >= briefHour && briefSent !== p.dayKey) {
      const cfg = await getTelegramConfig(db);
      if (cfg?.chatId) {
        const brief = await buildBrief(db, now);
        const { enqueueMessage } = await import("@/lib/telegram");
        await enqueueMessage(db, { kind: "brief", body: formatBrief(brief), now });
        await setSetting(db, "brief_sent_day", p.dayKey);
        briefStatus = "queued";
      } else briefStatus = "telegram not paired";
    }
    const { refreshChannelSubscribers } = await import("@/agents/deals");
    steps.deliver = { brief: briefStatus, webhook: (await ensureWebhook(db)).status, subscribers: (await refreshChannelSubscribers(db, now)).status, ...(await deliverMessages(db, now)) };

    // What waits on the owner, so the Run button can say it in one line.
    const [pending] = await db.select({ n: sql<string>`count(*)` }).from(approvals).where(and(eq(approvals.status, "pending"), eq(approvals.simulated, simulation)));
    steps.owner = { approvals: Number(pending?.n ?? 0) };

    // 8. Simulation keeps history continuous when nobody watches.
    steps.simulation = simulation ? await runSimulation(db, now, { maxSlices: 72 }) : { status: "off" };

    const finishedAt = new Date();
    await db.update(ticks).set({ status: "done", steps, finishedAt }).where(eq(ticks.id, tickId));
    return { id: tickId, trigger, startedAt: now.toISOString(), finishedAt: finishedAt.toISOString(), steps };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(ticks).set({ status: "failed", steps, error: message, finishedAt: new Date() }).where(eq(ticks.id, tickId));
    throw err;
  }
}
