import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBatches } from "@/agents/batches";
import { setAnthropicFactory } from "@/agents/client";
import { advanceDeals, dealPage, latestPostedDeals, publishPost, sitemapDeals } from "@/agents/deals";
import { engagementType, quizOptions, slotFor } from "@/agents/deals-engagement";
import { handleTaskBatchResult, submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { approvals, deals, floors, messagesOut, posts, setupItems, tasks } from "@/db/schema";
import { applyApprovalDecision } from "@/lib/approvals";
import { buildBrief } from "@/lib/brief";
import { channelHealthFrom, postableShareChats, refreshChannelSubscribers } from "@/lib/channel";
import { encryptSecret } from "@/lib/crypto";
import { getSettings, setSetting } from "@/lib/settings";
import { fitForX, oauth1Header, parseFacebookPage, parseXCredentials, setSocialTransport } from "@/lib/social";
import { setTelegramApi } from "@/lib/telegram";
import { processTelegramUpdate } from "@/lib/telegram-inbound";
import { fakeAnthropic, fakeSocial, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
let tg: ReturnType<typeof fakeTelegram>;
let social: ReturnType<typeof fakeSocial>;

// Dubai is UTC+4. Launch day is 2026-10-05, a Monday, but nothing depends on the weekday.
const at = (day: number, dubaiHour: number, minute = 0) => new Date(Date.UTC(2026, 9, day, dubaiHour - 4, minute));
const DAY1 = at(5, 16);
const DAY2 = at(6, 16);
const DAY4 = at(8, 16);
const DAY8 = at(12, 16);

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

async function runBatch(now: Date) {
  await submitQueuedTasks(db, now);
  await collectBatches(db, now, async (r) => handleTaskBatchResult(db, r, now));
}

async function approvalFor(kind: string) {
  const [p] = await db.select().from(posts).where(and(eq(posts.kind, kind), eq(posts.simulated, false))).orderBy(sql`${posts.createdAt} desc`).limit(1);
  const [a] = await db.select().from(approvals).where(eq(approvals.id, p!.approvalId!)).limit(1);
  return { post: p!, approval: a! };
}

async function approveAndPublish(kind: string, when: Date) {
  const { approval } = await approvalFor(kind);
  await applyApprovalDecision(db, approval.id, "approved", null, "ui", when);
  const [fresh] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1);
  return publishPost(db, fresh!, when);
}

const answers = (params: { messages: Array<{ content: unknown }> }) => {
  const text = JSON.stringify(params.messages[0]?.content ?? "");
  if (text.includes("Find today's deals")) return { deals: [], note: "Nothing new in this test." };
  if (text.includes("Find places to share the channel")) {
    return {
      spots: [
        { name: "r/dubai", url: "https://www.reddit.com/r/dubai/", kind: "subreddit", audience: "Dubai residents", rules: "Self promotion only in the weekly thread", allowsPromo: "ask_admin", message: "Weekly thread: a free channel of checked Amazon.ae deals." },
        { name: "UAE Bargain Hunters", url: "https://www.facebook.com/groups/uaebargains", kind: "facebook_group", audience: "Deal hunters", rules: "Deals welcome, no spam", allowsPromo: "yes", message: "Sharing a channel that posts checked UAE deals daily." },
        { name: "Broken", url: "not a url", kind: "other", audience: "", rules: "", allowsPromo: "unknown", message: "x" },
        { name: "r/dubai again", url: "https://www.reddit.com/r/dubai/", kind: "subreddit", audience: "", rules: "", allowsPromo: "unknown", message: "dup" },
      ],
      note: "Two places this week.",
    };
  }
  if (text.includes("Type: poll")) return { text: "", pollQuestion: "Which deals do you want more of next week?", pollOptions: ["Electronics", "Kitchen", "Baby and kids"], explanation: "" };
  if (text.includes("Type: quiz")) return { text: "", pollQuestion: "Guess the sale price of the Anker 65W charger", pollOptions: [], explanation: "It is AED 89, down from AED 145." };
  if (text.includes("Type: milestone")) return { text: "25 of you now. Thank you for being here.", pollQuestion: "", pollOptions: [], explanation: "" };
  if (text.includes("Type: share_ask")) return { text: "Know someone who shops online in the UAE? Share this channel with them.", pollQuestion: "", pollOptions: [], explanation: "" };
  if (text.includes("Write the post")) return { title: "Logitech mouse 30 percent off", body: "Logitech MX Master 3S\nAED 279, was AED 399, 30 percent off\nThe mouse most desk workers end up with." };
  return { text: "Hello", pollQuestion: "", pollOptions: [], explanation: "" };
};

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  tg = fakeTelegram();
  setTelegramApi(tg.api);
  social = fakeSocial();
  setSocialTransport(social.transport);
  setAnthropicFactory(() => fakeAnthropic(answers as never));
  await setSetting(db, "simulation_mode", false);
  await setSetting(db, "pipeline_day_docledger", "2026-10-11");
  // The Deals Engine is archived since D064; its code stays tested with the floor switched back on here.
  await db.update(floors).set({ status: "live" }).where(eq(floors.slug, "deals"));
  await db.update(floors).set({ status: "paused" }).where(eq(floors.slug, "growth"));
  await paste("anthropic_api_key", "sk-ant-test");
  await paste("affiliate_amazon_ae", "thetower-21");
  await paste("telegram_bot_token", "123:token");
  await paste("telegram_chat_id", "4242");
  await paste("deals_channel", "@uaedailydeals");
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setSocialTransport(null);
  if (close) await close();
});

describe("Deals channel growth", () => {
  it("tracks members, growth and whether the bot can post", async () => {
    await setSetting(db, "channel_history", { "2026-09-29": 12, "2026-10-04": 20 });
    tg.state.members = 27;
    const res = await refreshChannelSubscribers(db, DAY1);
    expect(res).toEqual({ status: "updated", count: 27, botCanPost: true });
    expect(tg.calls.find((c) => c.method === "getChatMember")?.body).toEqual({ chat_id: "@uaedailydeals", user_id: 999 });
    const health = channelHealthFrom(await getSettings(db), "2026-10-05");
    expect(health).toMatchObject({ members: 27, growthDay: 7, growthWeek: 15, botCanPost: true });
    expect((await refreshChannelSubscribers(db, new Date(DAY1.getTime() + 3600 * 1000))).status).toBe("fresh");

    tg.state.botStatus = "left";
    tg.state.canPost = false;
    await setSetting(db, "channel_checked_at", "2026-01-01T00:00:00Z");
    expect((await refreshChannelSubscribers(db, DAY1)).botCanPost).toBe(false);
    const brief = await buildBrief(db, DAY1);
    expect(brief.needs.some((n) => n.includes("@towerbot cannot post in the deals channel"))).toBe(true);
    expect(brief.floors.find((f) => f.slug === "deals")!.line).toContain("channel 27 members (+15 this week)");

    tg.state.botStatus = "administrator";
    tg.state.canPost = true;
    await setSetting(db, "channel_checked_at", "2026-01-01T00:00:00Z");
    expect((await refreshChannelSubscribers(db, DAY1)).botCanPost).toBe(true);
  });

  it("records the chats the owner adds the bot to, and ignores strangers", async () => {
    await processTelegramUpdate(db, { update_id: 1, my_chat_member: { chat: { id: -100555, title: "Dubai Bargains", type: "supergroup" }, from: { id: 4242 }, new_chat_member: { status: "member" } } }, DAY1);
    await processTelegramUpdate(db, { update_id: 2, my_chat_member: { chat: { id: -100666, title: "Some group", type: "group" }, from: { id: 7777 }, new_chat_member: { status: "member" } } }, DAY1);
    await processTelegramUpdate(db, { update_id: 3, my_chat_member: { chat: { id: -100777, title: "UAE Daily Deals", type: "channel", username: "uaedailydeals" }, from: { id: 4242 }, new_chat_member: { status: "administrator", can_post_messages: true } } }, DAY1);
    const s = await getSettings(db);
    expect(postableShareChats(s, "@uaedailydeals").map((c) => c.title)).toEqual(["Dubai Bargains"]);
    expect((s.channel_bot as { canPost: boolean }).canPost).toBe(true);
    const notes = await db.select().from(messagesOut).where(eq(messagesOut.kind, "bot_chat"));
    expect(notes).toHaveLength(3);
    expect(notes.some((m) => m.body === "The bot was added to Some group as member by someone else, so it will not post there.")).toBe(true);
  });

  it("starts every job on the first run, then waits for its interval, and holds posts when the bot cannot post", async () => {
    const created: Record<string, number> = {};
    await advanceDeals(db, DAY1, created);
    // Poll, share ask for the channel, share ask for the owner's group, and the 25 member milestone. No quiz yet: nothing posted.
    expect(created.write_engagement).toBe(4);
    expect(created.find_share_spots).toBe(1);
    const again: Record<string, number> = {};
    await advanceDeals(db, new Date(DAY1.getTime() + 3600 * 1000), again);
    expect(again.write_engagement).toBeUndefined();
    expect(again.find_share_spots).toBeUndefined();
    const slots = (await db.select().from(tasks).where(eq(tasks.kind, "write_engagement"))).map((t) => (t.input as Record<string, unknown>).slotKey).sort();
    expect(slots).toEqual(["milestone:25", "poll:2026-10-05", "share_ask:2026-10-05", "share_ask:2026-10-05:-100555"]);
    expect((await getSettings(db)).channel_milestones_done).toEqual([10, 25]);

    await setSetting(db, "channel_bot", { status: "left", canPost: false, checkedAt: DAY4.toISOString() });
    const held: Record<string, number> = {};
    await advanceDeals(db, DAY4, held);
    expect(held.write_engagement).toBeUndefined();
    await setSetting(db, "channel_bot", { status: "administrator", canPost: true, checkedAt: DAY4.toISOString() });
  });

  it("writes a poll and a milestone, and the publisher sends a real Telegram poll", async () => {
    await runBatch(DAY1);
    const { post, approval } = await approvalFor("poll");
    expect(approval.status).toBe("pending");
    expect(approval.summary).toMatch(/^Channel post \(poll\): Which deals do you want more of next week\?/);
    expect((post.extra as { poll: { options: string[] } }).poll.options).toEqual(["Electronics", "Kitchen", "Baby and kids"]);
    expect(post.scheduledAt?.toISOString()).toBe(at(5, 18, 30).toISOString());

    expect((await approveAndPublish("poll", at(5, 18, 45))).ok).toBe(true);
    const poll = tg.calls.filter((c) => c.method === "sendPoll").at(-1)!;
    expect(poll.body).toMatchObject({ chat_id: "@uaedailydeals", type: "regular", is_anonymous: true, options: [{ text: "Electronics" }, { text: "Kitchen" }, { text: "Baby and kids" }] });

    expect((await approveAndPublish("milestone", at(5, 18, 50))).ok).toBe(true);
    const thanks = tg.calls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(String(thanks.body.text)).toBe("25 of you now. Thank you for being here.\nhttps://t.me/uaedailydeals");
  });

  it("builds a guess the price quiz with the real price as the right answer", async () => {
    const q = quizOptions(89, 145, "seed");
    expect(q.options).toHaveLength(4);
    expect(new Set(q.options).size).toBe(4);
    expect(q.options[q.correct]).toBe("AED 89");
    expect(quizOptions(89, 145, "seed")).toEqual(q);

    const [dealsFloor] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    const [d] = await db.insert(deals).values({ floorId: dealsFloor!.id, store: "amazon_ae", title: "Anker 65W GaN charger", url: "https://www.amazon.ae/dp/B0ANKER6500", affiliateUrl: "https://www.amazon.ae/dp/B0ANKER6500?tag=thetower-21", price: "89.00", wasPrice: "145.00", discountPct: "39", status: "posted", dedupeKey: "amazon_ae|b0anker6500", simulated: false }).returning();
    await db.insert(posts).values({ floorId: dealsFloor!.id, kind: "deal", dealIds: [d!.id], body: "Anker 65W GaN charger\nhttps://x/go/anker1", status: "posted", shortCode: "anker1", postedAt: at(5, 12), simulated: false });

    const created: Record<string, number> = {};
    await advanceDeals(db, DAY2, created);
    expect(created.write_engagement).toBe(1); // the quiz: the poll ran yesterday, the share asks are weekly
    await runBatch(DAY2);
    const { post } = await approvalFor("quiz");
    const poll = (post.extra as { poll: { options: string[]; correct: number; quiz: boolean } }).poll;
    expect(poll.quiz).toBe(true);
    expect(poll.options[poll.correct]).toBe("AED 89");
    expect(post.dealIds).toEqual([d!.id]);

    expect((await approveAndPublish("quiz", at(6, 19, 45))).ok).toBe(true);
    const sent = tg.calls.filter((c) => c.method === "sendPoll").at(-1)!;
    expect(sent.body).toMatchObject({ type: "quiz", correct_option_id: poll.correct, explanation: "It is AED 89, down from AED 145." });
    // A quiz never shows up as a deal on the public page or in the sitemap.
    expect((await latestPostedDeals(db)).map((r) => r.post.kind)).toEqual(["deal"]);
    expect((await sitemapDeals(db)).map((r) => r.code)).toEqual(["anker1"]);
    expect((await dealPage(db, "anker1"))?.deal.title).toBe("Anker 65W GaN charger");
    expect(await dealPage(db, "nope12")).toBeNull();
  });

  it("asks for shares in the channel and in the owner's group from day one", async () => {
    const shares = await db.select().from(posts).where(eq(posts.kind, "share_ask"));
    expect(shares.map((p) => p.channel).sort()).toEqual(["telegram:-100555", "telegram_channel"]);
    const group = shares.find((p) => p.channel === "telegram:-100555")!;
    const [ga] = await db.select().from(approvals).where(eq(approvals.id, group.approvalId!)).limit(1);
    expect(ga!.riskNote).toContain("The owner added the bot to this group.");
    await applyApprovalDecision(db, ga!.id, "approved", null, "ui", DAY1);
    const [fresh] = await db.select().from(approvals).where(eq(approvals.id, ga!.id)).limit(1);
    expect((await publishPost(db, fresh!, new Date(group.scheduledAt!.getTime() + 60_000))).ok).toBe(true);
    const sent = tg.calls.filter((c) => c.method === "sendMessage").at(-1)!;
    expect(sent.body.chat_id).toBe("-100555");
    // A week later the share ask comes round again.
    const week: Record<string, number> = {};
    await advanceDeals(db, DAY8, week);
    const slots = (await db.select().from(tasks).where(eq(tasks.kind, "write_engagement"))).map((t) => String((t.input as Record<string, unknown>).slotKey));
    expect(slots).toContain("share_ask:2026-10-12");
    expect(slots).toContain("share_ask:2026-10-12:-100555");
  });

  it("lets a Warden push roll to tomorrow, drops a late planned draft, and reads the type from instructions", () => {
    expect(slotFor("recap", at(5, 23, 30), null)).toBeNull();
    expect(slotFor("recap", at(5, 23, 30), null, true)?.toISOString()).toBe(at(6, 22, 15).toISOString());
    expect(slotFor("poll", at(5, 10), null)?.toISOString()).toBe(at(5, 18, 30).toISOString());
    expect(engagementType({ instructions: "A quiz on the most clicked deal" })).toBe("quiz");
    expect(engagementType({ instructions: "share ask for the weekend" })).toBe("share_ask");
    expect(engagementType({ type: "recap" })).toBe("recap");
    expect(engagementType({})).toBe("poll");
  });

  it("finds places to share from day one and sends the share kit without repeats", async () => {
    const spots = (await getSettings(db)).share_spots as Array<{ url: string }>;
    expect(spots.map((x) => x.url)).toEqual(["https://www.reddit.com/r/dubai/", "https://www.facebook.com/groups/uaebargains"]);
    const kits = await db.select().from(messagesOut).where(eq(messagesOut.kind, "share_kit"));
    expect(kits).toHaveLength(1);
    expect(kits[0]!.body).toContain("UAE Bargain Hunters");
    expect(kits[0]!.body).toContain("Tip: add @towerbot");

    const { agents: agentsTable } = await import("@/db/schema");
    const [scout] = await db.select().from(agentsTable).where(eq(agentsTable.slug, "deals_scout")).limit(1);
    await db.insert(tasks).values({ floorId: scout!.floorId, agentId: scout!.id, kind: "find_share_spots", title: "Find places to share", status: "queued", priority: 4, input: { instructions: "Abu Dhabi groups" }, simulated: false });
    await runBatch(DAY8);
    expect(await db.select().from(messagesOut).where(eq(messagesOut.kind, "share_kit"))).toHaveLength(1);
  });

  it("parses X and Facebook keys and signs X requests", () => {
    expect(parseXCredentials("key secret token tokensecret")).toEqual({ apiKey: "key", apiSecret: "secret", accessToken: "token", accessSecret: "tokensecret" });
    expect(parseXCredentials("key secret token")).toBeNull();
    expect(parseFacebookPage("1234567890 EAAB")).toEqual({ pageId: "1234567890", token: "EAAB" });
    expect(parseFacebookPage("mypage EAAB")).toBeNull();
    const c = { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts" };
    const h = oauth1Header("POST", "https://api.x.com/2/tweets", c, "nonce", "1790000000");
    expect(h).toMatch(/^OAuth oauth_consumer_key="k", oauth_nonce="nonce", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1790000000", oauth_token="t", oauth_version="1.0"$/);
    expect(oauth1Header("POST", "https://api.x.com/2/tweets", { ...c, apiSecret: "other" }, "nonce", "1790000000")).not.toBe(h);
    const long = fitForX(["A".repeat(400), "https://example.com/a/very/long/link/that/counts/as/twenty/three", "#ad"]);
    expect(long.replace(/https?:\/\/\S+/g, "x".repeat(23)).length).toBeLessThanOrEqual(280);
    expect(long.endsWith("#ad")).toBe(true);
  });

  it("crossposts an approved deal to X and Facebook, and only where the approval says", async () => {
    await paste("x_credentials", "key secret token tokensecret");
    await paste("facebook_page", "1234567890 EAABtoken");
    const [dealsFloor] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
    const { agents: agentsTable } = await import("@/db/schema");
    const [editor] = await db.select().from(agentsTable).where(eq(agentsTable.slug, "deals_editor")).limit(1);
    const [d] = await db.insert(deals).values({ floorId: dealsFloor!.id, store: "amazon_ae", title: "Logitech MX Master 3S", url: "https://www.amazon.ae/dp/B0MXMASTER3", affiliateUrl: "https://www.amazon.ae/dp/B0MXMASTER3?tag=thetower-21", price: "279.00", wasPrice: "399.00", discountPct: "30", status: "found", sourceUrl: "https://gulfnews.com/deals", sourceDate: "2026-10-10", dedupeKey: "amazon_ae|b0mxmaster3", simulated: false }).returning();
    await db.insert(tasks).values({ floorId: dealsFloor!.id, agentId: editor!.id, kind: "write_post", title: "Write deal post", status: "queued", priority: 5, input: { dealId: d!.id }, simulated: false });
    await runBatch(DAY8);
    const { post, approval } = await approvalFor("deal");
    expect((approval.content as { destinations: string[] }).destinations).toEqual(["x", "facebook"]);
    expect(approval.riskNote).toContain("Also goes to X and Facebook.");

    const before = social.requests.length;
    await applyApprovalDecision(db, approval.id, "approved", null, "ui", DAY8);
    const [fresh] = await db.select().from(approvals).where(eq(approvals.id, approval.id)).limit(1);
    expect((await publishPost(db, fresh!, new Date(post.scheduledAt!.getTime() + 60_000))).ok).toBe(true);
    const sent = social.requests.slice(before);
    expect(sent.map((r) => new URL(r.url).hostname)).toEqual(["api.x.com", "graph.facebook.com"]);
    expect(sent[0]!.headers.authorization).toMatch(/^OAuth /);
    const tweet = JSON.parse(sent[0]!.body) as { text: string };
    expect(tweet.text).toContain(`/go/${post.shortCode}`);
    expect(tweet.text).toContain("More deals daily: https://t.me/uaedailydeals");
    expect(tweet.text.endsWith("#ad")).toBe(true);
    const form = new URLSearchParams(sent[1]!.body);
    expect(form.get("link")).toContain(`/go/${post.shortCode}`);
    expect(form.get("message")).toContain("As an Amazon Associate I earn from qualifying purchases.");
    const [after] = await db.select().from(posts).where(eq(posts.id, post.id)).limit(1);
    expect((after!.extra as { crossposts: Record<string, { ok: boolean }> }).crossposts).toMatchObject({ x: { ok: true }, facebook: { ok: true } });

    // A post whose approval names no destinations never leaves Telegram, even with keys on the clipboard.
    const [p2] = await db.insert(posts).values({ floorId: dealsFloor!.id, kind: "deal", dealIds: [d!.id], body: "Old approval\nhttps://x/go/old222", status: "approved", shortCode: "old222", scheduledAt: DAY8, simulated: false }).returning();
    const [a2] = await db.insert(approvals).values({ type: "public_post", status: "approved", summary: "Post to the deals channel: old", content: { postId: p2!.id, title: "old" }, simulated: false }).returning();
    const count = social.requests.length;
    expect((await publishPost(db, a2!, DAY8)).ok).toBe(true);
    expect(social.requests.length).toBe(count);
  });
});
