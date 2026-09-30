// Shared shapes and helpers for every worker playbook. Kept apart so floors can import it without cycles.
import type { Db } from "@/db/client";
import { taskEvents, tasks } from "@/db/schema";
import type { Effort } from "@/config/models";

export type TaskRow = typeof tasks.$inferSelect;

export interface PlaybookContext {
  db: Db;
  now: Date;
  floorId: string | null;
  agentId: string | null;
  agentName: string;
}

export interface Prepared {
  user: string;
  webSearchMaxUses?: number;
  webFetchMaxUses?: number;
}

export interface Absorbed {
  summary: string;
  extra?: Record<string, unknown>;
}

export interface Playbook {
  kind: string;
  system: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  webSearchMaxUses: number;
  webFetchMaxUses?: number;
  // Research playbooks set RESEARCH_EFFORT; the rest use the worker default.
  effort?: Effort;
  prepare(task: TaskRow, ctx: PlaybookContext): Promise<Prepared | { skip: string }>;
  absorb(task: TaskRow, output: Record<string, unknown>, ctx: PlaybookContext): Promise<Absorbed>;
}

export const STYLE = "Write plain English in short sentences. Never use hyphens or em dashes in any text you produce, use commas or colons instead. Never invent facts: only report what you saw on a page or in the input.";

export async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

export const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
export const input = (t: TaskRow) => (t.input ?? {}) as Record<string, unknown>;
