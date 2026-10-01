// The heartbeat's rules. Several clocks may knock (Neon's scheduler, GitHub, Vercel's daily cron, the owner's
// open game), so a tick holds a lock while it runs, and scheduled knocks closer than the gap are skipped.
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { settings, ticks } from "@/db/schema";

// A lock older than this belongs to a dead tick: Vercel stops a function after 300 seconds.
export const TICK_LOCK_MS = 6 * 60 * 1000;
// Scheduled ticks closer together than this are skipped. The main clock knocks every 5 minutes since Wall Street
// (D075): the trading pulse runs on every knock, a tick on every third.
export const HEARTBEAT_GAP_MS = 13 * 60 * 1000;
export const TICK_LOCK_KEY = "tick_lock";

// Who knocked. Anything else is recorded as "other".
export const HEARTBEAT_SOURCES = ["neon", "github", "vercel", "game", "owner", "other"] as const;
export type HeartbeatSource = (typeof HEARTBEAT_SOURCES)[number];

export function heartbeatSource(raw: string | null | undefined): HeartbeatSource {
  return (HEARTBEAT_SOURCES as readonly string[]).includes(raw ?? "") ? (raw as HeartbeatSource) : "other";
}

// One atomic statement: the row is written only when it is new or its holder went quiet, so two ticks
// starting in the same second cannot both get it.
export async function acquireTickLock(db: Db, holder: string, now = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - TICK_LOCK_MS);
  const value = { holder, at: now.toISOString() };
  const rows = await db
    .insert(settings)
    .values({ key: TICK_LOCK_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now }, setWhere: sql`${settings.updatedAt} < ${cutoff.toISOString()}` })
    .returning({ key: settings.key });
  return rows.length > 0;
}

export async function releaseTickLock(db: Db, holder: string): Promise<void> {
  await db
    .update(settings)
    .set({ value: { holder: null, at: null }, updatedAt: new Date(0) })
    .where(and(eq(settings.key, TICK_LOCK_KEY), sql`${settings.value}->>'holder' = ${holder}`));
}

export async function lastScheduledTickAt(db: Db): Promise<Date | null> {
  const [row] = await db.select({ startedAt: ticks.startedAt }).from(ticks).where(eq(ticks.trigger, "cron")).orderBy(desc(ticks.startedAt)).limit(1);
  return row?.startedAt ?? null;
}

export function heartbeatDue(last: Date | null, now = new Date(), gapMs = HEARTBEAT_GAP_MS): boolean {
  return !last || now.getTime() - last.getTime() >= gapMs;
}

// Work that must not overlap a tick (the owner's own email going out) waits for the lock, up to waitMs.
export async function withTickLock<T>(db: Db, fn: () => Promise<T>, waitMs = 0): Promise<{ ran: true; value: T } | { ran: false }> {
  const holder = randomUUID();
  const deadline = Date.now() + waitMs;
  while (!(await acquireTickLock(db, holder, new Date()))) {
    if (Date.now() >= deadline) return { ran: false };
    await new Promise((r) => setTimeout(r, 2000));
  }
  try {
    return { ran: true, value: await fn() };
  } finally {
    await releaseTickLock(db, holder).catch(() => undefined);
  }
}
