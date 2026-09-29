import { getDb } from "@/db/client";
import { telegramUpdates } from "@/db/schema";
import { json, unauthorized } from "@/lib/http";

export const dynamic = "force-dynamic";

// Phase 1: verify the secret header and store the update. Phase 4 processes approvals, ideas and commands.
export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || given !== expected) return unauthorized("Bad webhook secret");
  const payload = (await req.json().catch(() => null)) as { update_id?: number } | null;
  if (!payload || typeof payload.update_id !== "number") return json({ ok: true, ignored: true });
  await getDb().insert(telegramUpdates).values({ updateId: payload.update_id, payload }).onConflictDoNothing();
  return json({ ok: true });
}
