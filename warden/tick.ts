import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ticks, wardenRuns } from "@/db/schema";
import { guardSpend } from "@/lib/budget";
import { asBool, asNumber, getSettings } from "@/lib/settings";
import { dubaiParts } from "@/lib/time";
import { runSimulation } from "@/sim/generator";

export type TickTrigger = "cron" | "manual" | "setup" | "idea" | "blocked" | "ui";

export interface TickResult {
  id: string;
  trigger: TickTrigger;
  startedAt: string;
  finishedAt: string;
  steps: Record<string, unknown>;
}

// The heartbeat. Every step is bounded and idempotent, so a late or repeated tick is harmless.
// Phase 1 wires the frame and the simulation. Phases 4 to 6 fill in collect, warden, submit and deliver.
export async function runTick(trigger: TickTrigger, now = new Date()): Promise<TickResult> {
  const db = getDb();
  const [row] = await db.insert(ticks).values({ trigger, status: "running", startedAt: now }).returning({ id: ticks.id });
  const tickId = row?.id ?? "";
  const steps: Record<string, unknown> = {};

  try {
    const settingsMap = await getSettings(db);
    const simulation = asBool(settingsMap.simulation_mode, true);

    steps.collect = { status: "skipped", reason: "batch collection arrives in Phase 4" };
    steps.advance = { status: "skipped", reason: "pipeline advancing arrives in Phase 5" };

    const guard = await guardSpend(db, now);
    steps.guard = guard;

    const interval = asNumber(settingsMap.warden_interval_hours, 4);
    const p = dubaiParts(now);
    const wardenDue = p.hour % interval === 0 && p.minute < 20;
    steps.warden = { due: wardenDue, status: simulation ? "simulated" : "skipped", reason: simulation ? "Warden runs are simulated" : "real Warden arrives in Phase 4" };
    if (!simulation && wardenDue) {
      await db.insert(wardenRuns).values({ mode: "batch", trigger: "schedule", status: "failed", summary: "Real Warden not built yet (Phase 4)", startedAt: now, finishedAt: now });
    }

    steps.submit = { status: "skipped", reason: "batch submission arrives in Phase 4" };
    steps.deliver = { status: "skipped", reason: "Telegram delivery arrives in Phase 4" };

    if (simulation) {
      steps.simulation = await runSimulation(db, now, { maxSlices: 72 });
    } else {
      steps.simulation = { status: "off" };
    }

    const finishedAt = new Date();
    await db.update(ticks).set({ status: "done", steps, finishedAt }).where(eq(ticks.id, tickId));
    return { id: tickId, trigger, startedAt: now.toISOString(), finishedAt: finishedAt.toISOString(), steps };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(ticks).set({ status: "failed", steps, error: message, finishedAt: new Date() }).where(eq(ticks.id, tickId));
    throw err;
  }
}
