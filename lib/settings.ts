import { eq, sql } from "drizzle-orm";
import { DEFAULT_SETTINGS } from "@/config/tower";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

export type SettingsMap = Record<string, unknown>;

export async function getSettings(db: Db): Promise<SettingsMap> {
  const rows = await db.select().from(settings);
  const map: SettingsMap = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export async function getSetting<T>(db: Db, key: string, fallback: T): Promise<T> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  const row = rows[0];
  if (!row) return fallback;
  return (row.value as T) ?? fallback;
}

// JSON null must reach Postgres as the jsonb value null, not as SQL NULL (the column is not null).
export function jsonValue(value: unknown) {
  return value === null || value === undefined ? sql`'null'::jsonb` : (value as object);
}

export async function setSetting(db: Db, key: string, value: unknown): Promise<void> {
  const v = jsonValue(value);
  await db
    .insert(settings)
    .values({ key, value: v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
}

export function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

export function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
