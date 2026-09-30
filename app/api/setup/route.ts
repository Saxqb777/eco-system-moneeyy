import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { setupItems } from "@/db/schema";
import { encryptSecret, secretHint } from "@/lib/crypto";
import { bad, json, readJson } from "@/lib/http";
import { mockEnabled, mockSetup } from "@/lib/mock-state";
import { channelChatId, pairingCode } from "@/lib/telegram";
import { runTick } from "@/warden/tick";

export const dynamic = "force-dynamic";

// The clipboard. Values are never returned, only status and a hint.
export async function GET() {
  if (mockEnabled()) return json({ ok: true, items: mockSetup(), pairingCode: "a1b2c3" });
  const rows = await getDb().select().from(setupItems).orderBy(setupItems.sort);
  return json({
    ok: true,
    pairingCode: pairingCode(),
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

  let value = (body.value ?? "").trim();
  if (!value) return bad("value is empty");
  if (item.key === "deals_channel") {
    const clean = channelChatId(value);
    if (!clean) return bad("Paste the channel handle like @uaedailydeals (or its t.me link).");
    value = clean;
  }
  if (item.kind === "url" && !/^https?:\/\//.test(value)) return bad("Expected a URL starting with http");
  if (item.key === "telegram_chat_id" && !/^-?\d{5,20}$/.test(value)) return bad("A chat id is a number. Easiest: open your bot in Telegram and send the /pair line shown here.");

  const hint = item.kind === "secret" ? secretHint(value) : value.length > 80 ? `${value.slice(0, 77)}...` : value;
  await db
    .update(setupItems)
    .set({ status: "present", valueEncrypted: encryptSecret(value), hint, providedAt: new Date() })
    .where(eq(setupItems.key, item.key));
  // The brief asks for Warden to speak within 5 minutes of the key landing: an instant run after this response.
  // The Telegram token gets the same treatment so the webhook registers at once and /pair works straight away.
  if (item.key === "anthropic_api_key" || item.key === "telegram_bot_token" || item.key === "deals_channel") {
    after(async () => {
      await runTick("setup").catch(() => null);
    });
  }
  return json({ ok: true, key: item.key, status: "present", hint });
}
