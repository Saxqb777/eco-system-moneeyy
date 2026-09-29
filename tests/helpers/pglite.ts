import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedTower } from "@/db/seed";

// A real Postgres in process, with the real migrations and the real seed.
export async function makeTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  const dir = path.resolve(__dirname, "../../db/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const text = readFileSync(path.join(dir, file), "utf8");
    for (const stmt of text.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await db.execute(sql.raw(trimmed));
    }
  }
  await seedTower(db);
  return { db, close: () => client.close() };
}
