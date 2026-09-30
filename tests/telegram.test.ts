import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { approvals, floors, ideas, messagesOut, setupItems } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { encryptSecret } from "@/lib/crypto";
import { getSetting, setSetting } from "@/lib/settings";
import { channelChatId, deliverMessages, pairingCode, setTelegramApi } from "@/lib/telegram";
import { processTelegramUpdate } from "@/lib/telegram-inbound";
import { fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let tg: ReturnType<typeof fakeTelegram>;
const NOW = new Date("2026-10-06T08:00:00Z");
const OWNER = 4242;

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  tg = fakeTelegram();
  setTelegramApi(tg.api);
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret("123:token"), hint: "set" }).where(eq(setupItems.key, "telegram_bot_token"));
}, 60_000);

afterAll(async () => {
  if (close) await close();
});

const lastText = () => String(tg.calls.filter((c) => c.method === "sendMessage").at(-1)?.body.text ?? "");

describe("Telegram", () => {
  it("pairs only with the code from the Setup tab", async () => {
    const stranger = await processTelegramUpdate(db, { update_id: 1, message: { message_id: 1, text: "hello", chat: { id: 999 } } }, NOW);
    expect(stranger.handled).toMatch(/before pairing/);
    const wrong = await processTelegramUpdate(db, { update_id: 2, message: { message_id: 2, text: "/pair 000000", chat: { id: OWNER } } }, NOW);
    expect(wrong.handled).toMatch(/without a valid code/);
    expect(lastText()).toMatch(/six character code/);
    expect(lastText()).toContain(String(OWNER));
    const ok = await processTelegramUpdate(db, { update_id: 3, message: { message_id: 3, text: `/pair ${pairingCode()}`, chat: { id: OWNER } } }, NOW);
    expect(ok.handled).toBe("paired");
    expect(lastText()).toMatch(/Paired/);
    const again = await processTelegramUpdate(db, { update_id: 4, message: { message_id: 4, text: "/status", chat: { id: 999 } } }, NOW);
    expect(again.handled).toMatch(/stranger/);
  });

  it("answers commands", async () => {
    await processTelegramUpdate(db, { update_id: 5, message: { message_id: 5, text: "/status", chat: { id: OWNER } } }, NOW);
    expect(lastText()).toMatch(/DocLedger Sales/);
    await processTelegramUpdate(db, { update_id: 6, message: { message_id: 6, text: "/brief", chat: { id: OWNER } } }, NOW);
    expect(lastText()).toMatch(/Morning brief/);
    await processTelegramUpdate(db, { update_id: 7, message: { message_id: 7, text: "/pause deals", chat: { id: OWNER } } }, NOW);
    const [paused] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    expect(paused!.status).toBe("paused");
    await processTelegramUpdate(db, { update_id: 8, message: { message_id: 8, text: "/resume Deals Engine", chat: { id: OWNER } } }, NOW);
    const [live] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    expect(live!.status).toBe("live");
    await processTelegramUpdate(db, { update_id: 9, message: { message_id: 9, text: "/cap", chat: { id: OWNER } } }, NOW);
    expect(lastText()).toMatch(/Daily cap 1.70 USD/);
    const run = await processTelegramUpdate(db, { update_id: 10, message: { message_id: 10, text: "/run", chat: { id: OWNER } } }, NOW);
    expect(run.wantsTick).toBe("manual");
    for (const c of tg.calls) expect(String(c.body.text ?? "")).not.toMatch(/[—–]/);
  });

  it("turns plain text into an idea", async () => {
    const r = await processTelegramUpdate(db, { update_id: 11, message: { message_id: 11, text: "Try the Sharjah forwarders too", chat: { id: OWNER } } }, NOW);
    expect(r.handled).toBe("idea");
    expect(r.wantsTick).toBe("idea");
    const rows = await db.select().from(ideas).where(eq(ideas.source, "telegram"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.telegramMessageId).toBe(11);
  });

  it("rings the red phone and takes approve and reject with feedback", async () => {
    const { id } = await raiseApproval(db, { type: "decision", summary: "Open a second niche?", content: { text: "Customs brokers" }, riskNote: "None" }, NOW);
    const queued = await db.select().from(messagesOut).where(eq(messagesOut.relatedId, id));
    expect(queued).toHaveLength(1);
    const delivered = await deliverMessages(db, NOW);
    expect(delivered.sent).toBe(1);
    const sent = tg.calls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect((sent.body.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard[0]).toHaveLength(2);
    const [a1] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
    expect(a1!.telegramMessageId).toBeTruthy();

    // reject asks for feedback, the next message is the feedback
    await processTelegramUpdate(db, { update_id: 12, callback_query: { id: "cb1", data: `ap:${id}:r`, from: { id: OWNER }, message: { message_id: a1!.telegramMessageId!, text: "Approval needed", chat: { id: OWNER } } } }, NOW);
    expect(await getSetting(db, "telegram_pending_reject", null)).toMatchObject({ approvalId: id });
    await processTelegramUpdate(db, { update_id: 13, message: { message_id: 13, text: "Not yet, finish DocLedger first", chat: { id: OWNER } } }, NOW);
    const [a2] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
    expect(a2!.status).toBe("rejected");
    expect(a2!.feedback).toBe("Not yet, finish DocLedger first");
    expect(a2!.decidedVia).toBe("telegram");

    // approve goes straight through
    const { id: id2 } = await raiseApproval(db, { type: "floor_unlock", summary: "Unlock the Content Farm", content: { floor: "content" } }, NOW);
    const r = await processTelegramUpdate(db, { update_id: 14, callback_query: { id: "cb2", data: `ap:${id2}:a`, from: { id: OWNER }, message: { message_id: 500, text: "Approval needed", chat: { id: OWNER } } } }, NOW);
    expect(r.handled).toBe("approved");
    const [content] = await db.select().from(floors).where(eq(floors.slug, "content")).limit(1);
    expect(content!.status).toBe("live");
    const stranger = await processTelegramUpdate(db, { update_id: 15, callback_query: { id: "cb3", data: `ap:${id2}:a`, from: { id: 999 }, message: { message_id: 501, text: "x", chat: { id: 999 } } } }, NOW);
    expect(stranger.handled).toMatch(/stranger/);
  });

  it("retries a failed send and gives up after five", async () => {
    await deliverMessages(db, NOW); // clear what earlier tests queued
    let fail = true;
    setTelegramApi(async (_t, method, body) => {
      tg.calls.push({ method, body });
      return fail ? { ok: false, description: "boom" } : { ok: true, result: { message_id: 7 } };
    });
    const { enqueueMessage } = await import("@/lib/telegram");
    await enqueueMessage(db, { kind: "warden_note", body: "Warden: hello", now: NOW });
    const first = await deliverMessages(db, NOW);
    expect(first.failed).toBe(1);
    const [row] = await db.select().from(messagesOut).where(eq(messagesOut.kind, "warden_note")).limit(1);
    expect(row!.status).toBe("queued");
    expect(row!.attempts).toBe(1);
    expect(row!.sendAfter.getTime()).toBeGreaterThan(NOW.getTime());
    fail = false;
    const later = await deliverMessages(db, new Date(NOW.getTime() + 11 * 60 * 1000));
    expect(later.sent).toBe(1);
    setTelegramApi(tg.api);
    await setSetting(db, "telegram_pending_reject", null);
  });
});

describe("channelChatId", () => {
  it("turns whatever the owner pastes into the @handle Telegram expects", () => {
    expect(channelChatId("@Themarketdeals")).toBe("@Themarketdeals");
    expect(channelChatId("Themarketdeals")).toBe("@Themarketdeals");
    expect(channelChatId("t.me/Themarketdeals")).toBe("@Themarketdeals");
    expect(channelChatId("https://t.me/Themarketdeals/")).toBe("@Themarketdeals");
    expect(channelChatId("  https://telegram.me/Themarketdeals?start=1 ")).toBe("@Themarketdeals");
    expect(channelChatId("-1001234567890")).toBe("-1001234567890");
  });

  it("refuses junk instead of building a wrong chat id", () => {
    expect(channelChatId("")).toBeNull();
    expect(channelChatId(null)).toBeNull();
    expect(channelChatId("@")).toBeNull();
    expect(channelChatId("t.me/")).toBeNull();
    expect(channelChatId("ab")).toBeNull();
    expect(channelChatId("has space here")).toBeNull();
  });
});
