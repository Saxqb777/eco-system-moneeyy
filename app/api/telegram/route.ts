import { after } from "next/server";
import { getDb } from "@/db/client";
import { telegramUpdates } from "@/db/schema";
import { json, unauthorized } from "@/lib/http";
import { processTelegramUpdate, type TelegramUpdate } from "@/lib/telegram-inbound";
import { runTick } from "@/warden/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Telegram posts every update here with the secret token header. Each update is stored once, then handled.
export async function POST(req: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || given !== expected) return unauthorized("Bad webhook secret");
  const payload = (await req.json().catch(() => null)) as TelegramUpdate | null;
  if (!payload || typeof payload.update_id !== "number") return json({ ok: true, ignored: true });
  const db = getDb();
  const [stored] = await db.insert(telegramUpdates).values({ updateId: payload.update_id, payload }).onConflictDoNothing().returning({ updateId: telegramUpdates.updateId });
  if (!stored) return json({ ok: true, duplicate: true });
  let result;
  try {
    result = await processTelegramUpdate(db, payload);
  } catch (err) {
    return json({ ok: true, handled: "error", error: err instanceof Error ? err.message : String(err) });
  }
  if (result.wantsTick) {
    const trigger = result.wantsTick;
    after(async () => {
      await runTick(trigger).catch(() => null);
    });
  }
  return json({ ok: true, handled: result.handled });
}
