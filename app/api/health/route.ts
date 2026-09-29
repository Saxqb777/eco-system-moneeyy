import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    return json({ ok: true, db: "ok", ms: Date.now() - started, time: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, db: "error", error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
