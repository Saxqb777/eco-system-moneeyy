import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectBatches } from "@/agents/batches";
import { setAnthropicFactory } from "@/agents/client";
import { advancePipelines } from "@/agents/pipeline";
import { maybeRaiseAutoPost, nextPostSlot, SOCIAL_AUTO_DECISION, socialView } from "@/agents/social";
import { handleTaskBatchResult, submitQueuedTasks } from "@/agents/workers";
import type { Db } from "@/db/client";
import { agents, approvals, floors, posts, setupItems, tasks } from "@/db/schema";
import { applyApprovalDecision } from "@/lib/approvals";
import { encryptSecret } from "@/lib/crypto";
import { getSettings, setSetting } from "@/lib/settings";
import { setSocialTransport, type SocialRequest } from "@/lib/social";
import { setTelegramApi } from "@/lib/telegram";
import { fakeAnthropic, fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const graph: SocialRequest[] = [];
const comments: Array<{ id: string; message: string; from: { id: string; name: string } }> = [];

// Dubai is UTC+4.
const at = (day: number, dubaiHour: number, minute = 0) => new Date(Date.UTC(2026, 9, day, dubaiHour - 4, minute));
const PAGE = "1234567890";

async function paste(key: string, value: string) {
  await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret(value), hint: "set" }).where(eq(setupItems.key, key));
}

async function tick(now: Date) {
  await advancePipelines(db, now);
  await submitQueuedTasks(db, now);
  await collectBatches(db, now, async (r) => handleTaskBatchResult(db, r, now));
}

async function socialApprovals(status = "pending") {
  return (await db.select().from(approvals).where(and(eq(approvals.type, "public_post"), eq(approvals.status, status))).orderBy(desc(approvals.createdAt))).filter((a) => (a.content as Record<string, unknown>).social === "facebook");
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  const fake = fakeAnthropic((params) => {
    const system = JSON.stringify(params.system ?? "");
    if (system.includes("plan the next seven days")) {
      return {
        posts: [
          { day: 0, theme: "the problem", idea: "Month end in a freight office", image: "review" },
          { day: 1, theme: "product tip", idea: "Every charge line from one photo", image: "records" },
          { day: 2, theme: "demo invite", idea: "Try the demo, no signup", image: "none" },
          { day: 3, theme: "UAE finance tip", idea: "Keep the TRN on every bill", image: "types" },
        ],
        note: "Start with the problem.",
      };
    }
    if (system.includes("write today's Facebook post")) return { message: "Month end in a freight office — an envelope of bills.\nDoc Ledger reads each one from a photo.", link: "demo", image: "review" };
    if (system.includes("answer comments")) return { replies: [{ commentId: "c1", reply: "Yes, it reads PDFs too. Try the demo.", skip: false, why: "" }, { commentId: "c2", reply: "", skip: true, why: "just an emoji" }] };
    return {};
  });
  setAnthropicFactory(() => fake);
  let n = 0;
  setSocialTransport(async (r) => {
    graph.push(r);
    n += 1;
    if (r.method === "POST" && r.url.endsWith("/photos")) return { status: 200, json: { id: `photo_${n}`, post_id: `${PAGE}_${n}` } };
    if (r.method === "POST" && r.url.includes("/comments")) return { status: 200, json: { id: `reply_${n}` } };
    if (r.method === "POST") return { status: 200, json: { id: `${PAGE}_${n}` } };
    if (r.url.includes("/comments?")) return { status: 200, json: { data: comments } };
    if (r.url.includes("/insights?")) return { status: 200, json: { data: [{ name: "post_media_view", values: [{ value: 240 }] }] } };
    if (r.url.includes(`/${PAGE}?`)) return { status: 200, json: { followers_count: 42 } };
    return { status: 200, json: { reactions: { summary: { total_count: 11 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } } };
  });
  await setSetting(db, "simulation_mode", false);
  await paste("anthropic_api_key", "sk-ant-test");
  // only the Growth floor works in these tests
  await db.update(floors).set({ status: "paused", pausedReason: "Paused by the owner" }).where(eq(floors.slug, "docledger"));
  await db.update(floors).set({ status: "archived" }).where(eq(floors.slug, "deals"));
}, 60_000);

afterAll(async () => {
  setAnthropicFactory(null);
  setSocialTransport(null);
  if (close) await close();
});

describe("Social on the DocLedger Facebook Page", () => {
  it("is a seventh hire on the Growth floor", async () => {
    const [growth] = await db.select().from(floors).where(eq(floors.slug, "growth")).limit(1);
    const crew = await db.select().from(agents).where(eq(agents.floorId, growth!.id));
    expect(crew.map((a) => a.name)).toContain("Social");
    expect(crew).toHaveLength(7);
  });

  it("plans the week before the Page is connected, but writes no post without a Page", async () => {
    await tick(at(5, 9));
    const plan = (await getSettings(db)).social_plan as { items: Array<{ status: string; image: string }> };
    expect(plan.items).toHaveLength(4);
    expect(plan.items[0]!.image).toBe("review");
    expect(await db.select().from(tasks).where(eq(tasks.kind, "social_post"))).toHaveLength(0);
  });

  it("writes the day's post once the Page is connected and waits for the owner's tap", async () => {
    await paste("docledger_facebook_page", `${PAGE} EAAB-page-token`);
    await tick(at(5, 10));
    const [a] = await socialApprovals();
    expect(a).toBeTruthy();
    const content = a!.content as Record<string, unknown>;
    expect(content.imageUrl).toBe("https://docledger.site/landing/review.jpg");
    expect(content.link).toBe("https://demo.docledger.site");
    expect(String(content.body)).not.toMatch(/[—–]/);
    expect(a!.previewUrl).toBe("https://docledger.site/landing/review.jpg");
    expect(graph.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("posts the photo with the caption and the link as soon as he approves, inside the posting hours", async () => {
    const [a] = await socialApprovals();
    await applyApprovalDecision(db, a!.id, "approved", null, "ui", at(5, 11));
    const photo = graph.find((r) => r.method === "POST" && r.url.endsWith(`/${PAGE}/photos`));
    expect(photo).toBeTruthy();
    const form = new URLSearchParams(photo!.body);
    expect(form.get("url")).toBe("https://docledger.site/landing/review.jpg");
    expect(form.get("caption")).toContain("https://demo.docledger.site");
    expect(form.get("access_token")).toBe("EAAB-page-token");
    const [p] = await db.select().from(posts).where(eq(posts.kind, "social")).limit(1);
    expect(p!.status).toBe("posted");
    expect((p!.extra as Record<string, unknown>).externalId).toMatch(new RegExp(`^${PAGE}_`));
  });

  it("holds an approved post until the morning when it is approved at night", async () => {
    expect(nextPostSlot(at(5, 23)).toISOString()).toBe(at(6, 9).toISOString());
    expect(nextPostSlot(at(6, 3)).toISOString()).toBe(at(6, 9).toISOString());
    await tick(at(5, 22)); // the next item is not due until tomorrow
    expect(await socialApprovals()).toHaveLength(0);
    await tick(at(6, 7)); // written early in the morning
    const [a] = await socialApprovals();
    const before = graph.filter((r) => r.method === "POST").length;
    await applyApprovalDecision(db, a!.id, "approved", null, "ui", at(6, 8));
    expect(graph.filter((r) => r.method === "POST").length).toBe(before);
    await advancePipelines(db, at(6, 9, 5));
    expect(graph.filter((r) => r.method === "POST").length).toBe(before + 1);
  });

  it("reads the numbers once a day", async () => {
    await advancePipelines(db, at(6, 20, 10));
    const v = await socialView(db, at(6, 20, 20));
    expect(v.connected).toBe(true);
    expect(v.followers).toBe(42);
    expect(v.week.posts).toBe(2);
    expect(v.week.reactions).toBe(22);
    expect(v.week.views).toBe(480);
  });

  it("drafts answers to new comments, and an answer always waits on the owner", async () => {
    comments.push({ id: "c1", message: "Does it read PDF bills?", from: { id: "u1", name: "Rania" } });
    comments.push({ id: "c2", message: "👍", from: { id: "u2", name: "Omar" } });
    comments.push({ id: "c3", message: "Thanks for the questions!", from: { id: PAGE, name: "DocLedger" } });
    await setSetting(db, "social_auto_post", true); // even with auto posting on
    await tick(at(7, 10));
    const replies = (await socialApprovals()).filter((a) => (a.content as Record<string, unknown>).replyTo);
    expect(replies).toHaveLength(1);
    expect((replies[0]!.content as Record<string, unknown>).replyTo).toBe("c1");
    await applyApprovalDecision(db, replies[0]!.id, "approved", null, "ui", at(7, 10, 5));
    const sent = graph.find((r) => r.method === "POST" && r.url.includes("/c1/comments"));
    expect(new URLSearchParams(sent!.body).get("message")).toBe("Yes, it reads PDFs too. Try the demo.");
    // seen comments are not answered twice
    await tick(at(7, 11));
    expect((await socialApprovals("pending")).filter((a) => (a.content as Record<string, unknown>).replyTo)).toHaveLength(0);
    await setSetting(db, "social_auto_post", false);
  });

  it("asks once to post on its own after ten approvals in a row, and then posts without a tap, within the daily limit", async () => {
    const [growth] = await db.select().from(floors).where(eq(floors.slug, "growth")).limit(1);
    for (let i = 0; i < 8; i++) {
      await db.insert(approvals).values({ type: "public_post", status: "approved", summary: `Facebook post ${i}`, content: { social: "facebook" }, decidedAt: at(4, 10, i), decidedVia: "ui", simulated: false, createdAt: at(4, 9), updatedAt: at(4, 10) });
    }
    expect(await maybeRaiseAutoPost(db, growth!.id, at(7, 12))).toBe(true);
    expect(await maybeRaiseAutoPost(db, growth!.id, at(7, 12, 5))).toBe(false); // once
    const [decision] = await db.select().from(approvals).where(and(eq(approvals.type, "decision"), eq(approvals.summary, SOCIAL_AUTO_DECISION))).limit(1);
    await applyApprovalDecision(db, decision!.id, "approved", null, "telegram", at(7, 12, 10));
    expect((await getSettings(db)).social_auto_post).toBe(true);

    const before = graph.filter((r) => r.url.endsWith("/photos")).length;
    const autoBefore = (await db.select().from(approvals).where(eq(approvals.decidedVia, "auto"))).length;
    await tick(at(8, 13)); // the day 4 item: written and approved with no tap
    const auto = (await db.select().from(approvals).where(eq(approvals.decidedVia, "auto"))).filter((a) => (a.content as Record<string, unknown>).social === "facebook");
    expect(auto.length).toBe(autoBefore + 1);
    await advancePipelines(db, at(8, 13, 20));
    expect(graph.filter((r) => r.url.endsWith("/photos")).length).toBe(before + 1);
  });

  it("never posts more than the daily limit", async () => {
    await setSetting(db, "social_posts_per_day", 1);
    const [growth] = await db.select().from(floors).where(eq(floors.slug, "growth")).limit(1);
    const [p] = await db.insert(posts).values({ floorId: growth!.id, kind: "social", body: "One more today", channel: "facebook_page", status: "approved", scheduledAt: at(8, 9), extra: {}, simulated: false }).returning();
    const [a] = await db.insert(approvals).values({ type: "public_post", status: "approved", summary: "Facebook post: one more", content: { social: "facebook", postId: p!.id }, decidedAt: at(8, 14), decidedVia: "ui", simulated: false }).returning();
    await advancePipelines(db, at(8, 14, 30));
    const [fresh] = await db.select().from(approvals).where(eq(approvals.id, a!.id)).limit(1);
    expect(fresh!.executedAt).toBeNull();
    expect((fresh!.executionResult as Record<string, unknown>).deferred).toBe("today's posts are done, this one goes tomorrow");
    await setSetting(db, "social_posts_per_day", 2);
  });
});
