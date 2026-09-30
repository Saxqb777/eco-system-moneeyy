import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ideas } from "@/db/schema";
import { bad, json, readJson } from "@/lib/http";
import { mockEnabled, mockIdeas } from "@/lib/mock-state";

export const dynamic = "force-dynamic";

export async function GET() {
  if (mockEnabled()) return json({ ok: true, ideas: mockIdeas() });
  const rows = await getDb().select().from(ideas).orderBy(desc(ideas.createdAt)).limit(100);
  return json({ ok: true, ideas: rows });
}

export async function POST(req: Request) {
  const body = await readJson<{ text?: string }>(req);
  const text = body?.text?.trim() ?? "";
  if (text.length < 3) return bad("Write the idea first");
  if (mockEnabled()) return json({ ok: true, idea: { id: `mock_${Date.now()}`, text, source: "ui", status: "new", createdAt: new Date().toISOString() } });
  const [row] = await getDb().insert(ideas).values({ text, source: "ui", status: "new" }).returning();
  return json({ ok: true, idea: row });
}
