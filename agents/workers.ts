// Worker batch pipeline. Phase 4 ships the frame; Phase 5 fills the playbooks and result handling.
import type { Db } from "@/db/client";
import type { CollectedResult } from "./batches";

export async function submitQueuedTasks(_db: Db, _now = new Date()): Promise<{ status: string; reason?: string; submitted?: number }> {
  return { status: "skipped", reason: "worker playbooks arrive in Phase 5" };
}

export async function handleTaskBatchResult(_db: Db, _r: CollectedResult): Promise<void> {
  // Phase 5
}
