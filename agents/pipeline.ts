// Moves tasks along their floor pipelines. Phase 5 fills this in.
import type { Db } from "@/db/client";

export async function advancePipelines(_db: Db, _now = new Date()): Promise<{ status: string; reason?: string }> {
  return { status: "skipped", reason: "pipelines arrive in Phase 5" };
}
