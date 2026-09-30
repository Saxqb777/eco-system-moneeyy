// Deals Engine floor (Phase 6). The frame is here so Phase 5 compiles; the playbooks and the channel arrive next.
import type { Db } from "@/db/client";
import type { approvals } from "@/db/schema";

export async function advanceDeals(_db: Db, _now: Date, _created: Record<string, number>): Promise<void> {
  // Phase 6
}

export async function publishPost(_db: Db, _a: typeof approvals.$inferSelect, _now = new Date()): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "posting arrives in Phase 6" };
}
