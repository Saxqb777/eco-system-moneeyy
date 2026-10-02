import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { approvals, messagesOut, setupItems, taskEvents } from "@/db/schema";
import { applyApprovalDecision, raiseApproval } from "@/lib/approvals";
import { clipboardValue } from "@/lib/clipboard";
import { detectSecret } from "@/lib/setup-store";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const T0 = new Date("2026-10-02T11:00:00Z");
const RESEND = "re_TestKeyAbc123DefGhi456JklMno789Pqr";
const BOT = "123456789:AAEabcdefghijklmnopqrstuvwxyz0123456789";
const FB_TOKEN = `EAA${"Ab1".repeat(20)}`;

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  await setSetting(db, "simulation_mode", false);
}, 60_000);

afterAll(async () => {
  if (close) await close();
});

async function item(key: string) {
  const [row] = await db.select().from(setupItems).where(eq(setupItems.key, key)).limit(1);
  return row!;
}

async function setupMessages() {
  return db.select().from(messagesOut).where(eq(messagesOut.kind, "setup"));
}

describe("A key typed into an approval note (D082)", () => {
  it("knows the shapes and which box they belong in", () => {
    expect(detectSecret(`here: ${RESEND}`)).toEqual({ key: "resend_api_key", value: RESEND, complete: true });
    expect(detectSecret(BOT)?.key).toBe("telegram_bot_token");
    expect(detectSecret("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789")?.key).toBe("anthropic_api_key");
    expect(detectSecret(`1381632208357877 ${FB_TOKEN}`)).toMatchObject({ key: "docledger_facebook_page", complete: true });
    expect(detectSecret(FB_TOKEN)).toMatchObject({ key: "docledger_facebook_page", complete: false });
    expect(detectSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD")?.key).toBe("docledger_github_token");
    // something long and keylike with no known shape
    expect(detectSecret(`token ${"x9".repeat(20)} ok`)).toEqual({ key: null, value: "x9".repeat(20), complete: false });
    // not secrets: words, an email id, a link
    expect(detectSecret("Looks good, send it on Monday")).toBeNull();
    expect(detectSecret("email id 61a5e7cd-8373-4392-97d8-0f7f34fd4a84")).toBeNull();
    expect(detectSecret("https://demo.docledger.site/?for=8cgghn")).toBeNull();
    expect(detectSecret("")).toBeNull();
    expect(detectSecret(null)).toBeNull();
  });

  it("moves a Resend key from a credential request note into its Setup box", async () => {
    const { id } = await raiseApproval(db, { type: "credential_request", summary: "Full access Resend key", content: { text: "So the reply bodies can be read.", setupKey: "resend_api_key" } }, T0);
    const before = await item("resend_api_key");
    expect(before.status).toBe("missing");
    await applyApprovalDecision(db, id, "approved", `here you go ${RESEND}`, "ui", T0);
    const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(a!.status).toBe("approved");
    expect(a!.feedback).toContain("moved to the Setup box");
    expect(a!.feedback).not.toContain("re_Test");
    const after = await item("resend_api_key");
    expect(after.status).toBe("present");
    expect(after.hint).toBe(`ends with ${RESEND.slice(-4)}`);
    expect(await clipboardValue(db, "resend_api_key")).toBe(RESEND);
    const msgs = await setupMessages();
    expect(msgs.length).toBe(1);
    expect(msgs[0]!.body).toContain("saved it in the Setup box");
    expect(msgs[0]!.body).not.toContain("re_Test");
    const logs = await db.select().from(taskEvents).where(eq(taskEvents.type, "log"));
    expect(logs.some((l) => l.message.includes("moved to Setup"))).toBe(true);
    // the Telegram echo of the decision carries the marker, never the key
    const echoes = await db.select().from(messagesOut).where(eq(messagesOut.kind, "approval_decided"));
    expect(echoes.every((m) => !m.body.includes("re_Test"))).toBe(true);
  });

  it("recognises a bot token in any note, even a rejection with no box named", async () => {
    const { id } = await raiseApproval(db, { type: "decision", summary: "A worker needs you: which bot token", content: { text: "Reply with your note." } }, T0);
    await applyApprovalDecision(db, id, "rejected", `use this one ${BOT} and drop the rest`, "ui", T0);
    const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(a!.status).toBe("rejected");
    expect(a!.feedback).not.toContain("AAEabc");
    expect((await item("telegram_bot_token")).status).toBe("present");
    expect(await clipboardValue(db, "telegram_bot_token")).toBe(BOT);
  });

  it("drops what it cannot save and says which box to use", async () => {
    const { id } = await raiseApproval(db, { type: "credential_request", summary: "DocLedger Facebook Page", content: { text: "Page ID plus token.", setupKey: "docledger_facebook_page" } }, T0);
    await applyApprovalDecision(db, id, "approved", FB_TOKEN, "ui", T0);
    const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(a!.feedback).toContain("not saved");
    expect(a!.feedback).toContain("DocLedger Facebook Page");
    expect(a!.feedback).not.toContain("EAAAb1");
    expect((await item("docledger_facebook_page")).status).toBe("missing");
    const msgs = await setupMessages();
    expect(msgs.at(-1)!.body).toContain("Page ID and the token");
    expect(msgs.at(-1)!.body).not.toContain("EAAAb1");
  });

  it("removes an unknown shape without saving it anywhere", async () => {
    const { id } = await raiseApproval(db, { type: "decision", summary: "Which address", content: { text: "Reply with the address." } }, T0);
    const blob = "x9".repeat(20);
    await applyApprovalDecision(db, id, "approved", blob, "ui", T0);
    const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(a!.feedback).toContain("Paste it in the Setup tab");
    expect(a!.feedback).not.toContain(blob);
    const present = await db.select().from(setupItems).where(eq(setupItems.status, "present"));
    expect(present.map((p) => p.key).sort()).toEqual(["resend_api_key", "telegram_bot_token"]);
  });

  it("leaves an ordinary note alone", async () => {
    const { id } = await raiseApproval(db, { type: "decision", summary: "Plain question", content: { text: "Yes or no?" } }, T0);
    await applyApprovalDecision(db, id, "rejected", "No, try the shorter version on Monday", "ui", T0);
    const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
    expect(a!.feedback).toBe("No, try the shorter version on Monday");
  });
});
