import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBatches } from "@/agents/batches";
import { setAnthropicFactory } from "@/agents/client";
import { advancePipelines } from "@/agents/pipeline";
import { latestPostedDeals, recordClick } from "@/agents/deals";
import { handleTaskBatchResult, submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { approvals, clicks, deals, floors, posts, setupItems, tasks } from "@/db/schema";
import { affiliateUrl } from "@/lib/affiliate";
import { applyApprovalDecision } from "@/lib/approvals";
import { encryptSecret } from "@/lib/crypto";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let tg: ReturnType<typeof fakeTelegram>;
const TEN = new Date("2026-10-06T06:00:00Z"); // 10:00 Dubai
const EVENING = new Date("2026-10-06T19:30:00Z"); // 23:30 Dubai, every slot of the day has passed

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  tg = fakeTelegram();
  setTelegramApi(tg.api);
  await setSetting(db, "simulation_mode", false);
  await setSetting(db, "pipeline_day_docledger", "2026-10-06"); // keep the other floor quiet
  await paste("anthropic_api_key", "sk-ant-test");
  await paste("affiliate_amazon_ae", "thetower-21");
  await paste("telegram_bot_token", "123:token");
  await paste("telegram_chat_id", "4242");
  await paste("deals_channel", "@uaedailydeals");
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  if (close) await close();
});

describe("Deals Engine", () => {
  it("adds the Associates tag to Amazon.ae links and leaves the rest plain", () => {
    const tags = { amazonAe: "thetower-21", noon: null, other: null };
    expect(affiliateUrl("https://www.amazon.ae/dp/B0ABC12345?ref=x", "amazon_ae", tags)).toEqual({ url: "https://www.amazon.ae/dp/B0ABC12345?ref=x&tag=thetower-21", earns: true });
    expect(affiliateUrl("https://www.noon.com/uae-en/p/N123", "noon", tags)).toEqual({ url: "https://www.noon.com/uae-en/p/N123", earns: false });
    expect(affiliateUrl("https://www.noon.com/uae-en/p/N123", "noon", { ...tags, noon: "https://go.net/?u={url}" }).earns).toBe(true);
  });

  it("scouts real deals, writes posts, rings the phone, posts on schedule and counts clicks", async () => {
    const fake = fakeAnthropic((params) => {
      const text = JSON.stringify(params.messages[0]?.content ?? "");
      if (text.includes("Find today's deals")) {
        return {
          deals: [
            { store: "amazon_ae", title: "Anker 65W GaN charger", url: "https://www.amazon.ae/dp/B0ANKER6500", price: 89, wasPrice: 145, discountPct: 38, category: "electronics", imageUrl: "" },
            { store: "noon", title: "Philips air fryer 6L", url: "https://www.noon.com/uae-en/p/N40001", price: 299, wasPrice: 399, discountPct: 25, category: "kitchen", imageUrl: "" },
            { store: "amazon_ae", title: "Tiny discount thing", url: "https://www.amazon.ae/dp/B0TINY00001", price: 95, wasPrice: 100, discountPct: 5, category: "x", imageUrl: "" },
            { store: "amazon_ae", title: "Wrong host", url: "https://example.com/x", price: 10, wasPrice: 50, discountPct: 80, category: "x", imageUrl: "" },
          ],
          note: "Amazon page loaded, Noon loaded",
        };
      }
      if (text.includes("Write the post")) return { title: "Anker 65W charger 38 percent off", body: "Anker 65W GaN charger\nAED 89, was AED 145, 38 percent off\nCharges a laptop and a phone from one small brick." };
      return {};
    });
    setAnthropicFactory(() => fake);

    const a1 = await advancePipelines(db, TEN);
    expect(a1.created.find_deals).toBe(1);
    await submitQueuedTasks(db, TEN);
    const req = [...fake.batches.values()].at(-1)![0]!;
    expect(req.params.tools?.map((t) => t.type)).toEqual(["web_search_20260318", "web_fetch_20260318"]);
    await collectBatches(db, TEN, async (r) => handleTaskBatchResult(db, r, TEN));
    const found = await db.select().from(deals).where(eq(deals.simulated, false));
    expect(found).toHaveLength(2);
    const anker = found.find((d) => d.title.startsWith("Anker"))!;
    expect(anker.affiliateUrl).toContain("tag=thetower-21");
    expect(Number(anker.discountPct)).toBe(39);

    const a2 = await advancePipelines(db, TEN);
    expect(a2.created.write_post).toBe(2);
    await submitQueuedTasks(db, TEN);
    await collectBatches(db, TEN, async (r) => handleTaskBatchResult(db, r, TEN));
    const drafts = await db.select().from(posts).where(eq(posts.simulated, false));
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.shortCode).toMatch(/^[a-z0-9]{6}$/);
    expect(drafts[0]!.body).toContain(`/go/${drafts[0]!.shortCode}`);
    const pending = await db.select().from(approvals).where(and(eq(approvals.type, "public_post"), eq(approvals.status, "pending")));
    expect(pending).toHaveLength(2);

    // approve one: it waits for its slot, then posts to the channel
    const first = pending[0]!;
    await applyApprovalDecision(db, first.id, "approved", null, "ui", TEN);
    const early = await advancePipelines(db, TEN);
    expect(early.deferred.some((d) => /scheduled/.test(d))).toBe(true);
    const late = await advancePipelines(db, EVENING);
    expect(late.executed).toBe(1);
    const channelSends = tg.calls.filter((c) => c.method === "sendMessage" && c.body.chat_id === "@uaedailydeals");
    expect(channelSends).toHaveLength(1);
    const [posted] = await db.select().from(posts).where(eq(posts.approvalId, first.id)).limit(1);
    expect(posted!.status).toBe("posted");
    expect(posted!.telegramMessageId).toBeTruthy();
    const publisherTasks = await db.select().from(tasks).where(eq(tasks.kind, "publish_post"));
    expect(publisherTasks).toHaveLength(1);

    // the tracked link counts and redirects to the affiliate url
    const target = await recordClick(db, posted!.shortCode!, { referrer: "https://t.me/uaedailydeals", userAgent: "Mozilla/5.0" }, EVENING);
    expect(target).toMatch(/^https:\/\/www\.(amazon\.ae|noon\.com)\//);
    const [after] = await db.select().from(posts).where(eq(posts.id, posted!.id)).limit(1);
    expect(after!.clicks).toBe(1);
    expect(await db.select().from(clicks)).toHaveLength(1);
    expect(await recordClick(db, "zzzzzz", {}, EVENING)).toBeNull();
    const page = await latestPostedDeals(db);
    expect(page).toHaveLength(1);
    expect(page[0]!.deal.title).toBeTruthy();
  });

  it("auto approves posts once the floor rule is on", async () => {
    await db.update(floors).set({ autoApprove: true, autoApproveSince: TEN }).where(eq(floors.slug, "deals"));
    const [dealsFloor] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    const [d] = await db.insert(deals).values({ floorId: dealsFloor!.id, store: "amazon_ae", title: "Logitech MX Master 3S", url: "https://www.amazon.ae/dp/B0MXMASTER3", affiliateUrl: "https://www.amazon.ae/dp/B0MXMASTER3?tag=thetower-21", price: "279.00", wasPrice: "399.00", discountPct: "30", status: "found", dedupeKey: "amazon_ae|/dp/b0mxmaster3", simulated: false }).returning();
    const fake = fakeAnthropic(() => ({ title: "MX Master 3S 30 percent off", body: "Logitech MX Master 3S\nAED 279, was AED 399, 30 percent off\nThe mouse most desk workers end up with." }));
    setAnthropicFactory(() => fake);
    const { agents: agentsTable } = await import("@/db/schema");
    const [ed] = await db.select().from(agentsTable).where(eq(agentsTable.slug, "deals_editor")).limit(1);
    await db.insert(tasks).values({ floorId: dealsFloor!.id, agentId: ed!.id, kind: "write_post", title: "Write deal post", status: "queued", priority: 5, input: { dealId: d!.id }, simulated: false });
    await submitQueuedTasks(db, EVENING);
    await collectBatches(db, EVENING, async (r) => handleTaskBatchResult(db, r, EVENING));
    const [ap] = await db.select().from(approvals).where(and(eq(approvals.type, "public_post"), eq(approvals.decidedVia, "auto")));
    expect(ap).toBeTruthy();
    expect(ap!.status).toBe("approved");
    const before = tg.calls.filter((c) => c.method === "sendMessage" && c.body.chat_id === "4242" && String(c.body.text).includes("MX Master"));
    expect(before).toHaveLength(0);
  });
});
