import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { setupItems } from "@/db/schema";
import { encryptSecret, secretHint } from "@/lib/crypto";
import { bad, json, readJson } from "@/lib/http";
import { mockEnabled, mockSetup } from "@/lib/mock-state";

export const dynamic = "force-dynamic";

// The clipboard. Values are never returned, only status and a hint.
export async function GET() {
  if (mockEnabled()) return json({ ok: true, items: mockSetup() });
  const rows = await getDb().select().from(setupItems).orderBy(setupItems.sort);
  return json({
    ok: true,
    items: rows.map((r) => ({ key: r.key, label: r.label, howTo: r.howTo, kind: r.kind, requiredFor: r.requiredFor, status: r.status, hint: r.hint, providedAt: r.providedAt })),
  });
}

// Body: { key, value } to store, or { key, clear: true } to remove.
export async function POST(req: Request) {
  const db = getDb();
  const body = await readJson<{ key?: string; value?: string; clear?: boolean }>(req);
  if (!body?.key) return bad("key is required");
  if (mockEnabled()) return json({ ok: true, key: body.key, status: body.clear ? "missing" : "present", hint: body.clear ? null : "saved in mock mode only" });
  const [item] = await db.select().from(setupItems).where(eq(setupItems.key, body.key)).limit(1);
  if (!item) return bad("Unknown setup item", 404);

  if (body.clear) {
    await db.update(setupItems).set({ status: "missing", valueEncrypted: null, hint: null, providedAt: null }).where(eq(setupItems.key, item.key));
    return json({ ok: true, key: item.key, status: "missing" });
  }

  const value = (body.value ?? "").trim();
  if (!value) return bad("value is empty");
  if (item.kind === "url" && !/^https?:\/\//.test(value)) return bad("Expected a URL starting with http");

  const hint = item.kind === "secret" ? secretHint(value) : value.length > 80 ? `${value.slice(0, 77)}...` : value;
  await db
    .update(setupItems)
    .set({ status: "present", valueEncrypted: encryptSecret(value), hint, providedAt: new Date() })
    .where(eq(setupItems.key, item.key));
  return json({ ok: true, key: item.key, status: "present", hint });
}
