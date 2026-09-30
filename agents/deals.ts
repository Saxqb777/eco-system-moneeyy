// Deals Engine floor: the day's scout run, editor posts, and publishing approved posts to the channel on schedule.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, approvals, clicks, deals, floors, posts, taskEvents, tasks } from "@/db/schema";
import { isAmazonDeal, withDisclosure } from "@/lib/affiliate";
import { clipboardValue } from "@/lib/clipboard";
import { getSettings, setSetting } from "@/lib/settings";
import { fitForX, postToFacebook, postToX, type Destination, type SocialResult } from "@/lib/social";
import { channelChatId, getTelegramConfig, sendNow, telegramCall } from "@/lib/telegram";
import { dubaiParts } from "@/lib/time";
import { planEngagement, planShareSpots } from "./deals-engagement";
import { openTasksOfKind } from "./playbooks";

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; data?: unknown; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, data: e.data ?? null, createdAt: e.at });
}

export async function advanceDeals(db: Db, now: Date, created: Record<string, number>): Promise<void> {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "deals")).limit(1);
  if (!floor || floor.status !== "live") return;
  const crew = await db.select().from(agents).where(eq(agents.floorId, floor.id));
  const scout = crew.find((a) => a.slug === "deals_scout");
  const editor = crew.find((a) => a.slug === "deals_editor");
  const p = dubaiParts(now);
  const settingsMap = await getSettings(db);

  if (scout && p.hour >= 9 && settingsMap.pipeline_day_deals !== p.dayKey) {
    if ((await openTasksOfKind(db, scout.id, "find_deals")) === 0) {
      const [row] = await db.insert(tasks).values({ floorId: floor.id, agentId: scout.id, kind: "find_deals", title: "Scan store deals", status: "queued", priority: 5, input: { instructions: floor.strategyNote ?? "" }, simulated: false, createdAt: now, updatedAt: now }).returning({ id: tasks.id });
      await logEvent(db, { taskId: row?.id, agentId: scout.id, floorId: floor.id, type: "created", message: "Scan store deals queued", at: now });
      created.find_deals = (created.find_deals ?? 0) + 1;
    }
    await setSetting(db, "pipeline_day_deals", p.dayKey);
  }
  if (scout) await planShareSpots(db, now, floor, scout.id, created);

  if (editor) {
    const dayStart = new Date(now.getTime() - ((p.hour * 60 + p.minute) * 60 * 1000));
    const [todayPosts] = await db.select({ n: sql<string>`count(*)` }).from(posts).where(and(eq(posts.simulated, false), eq(posts.kind, "deal"), sql`${posts.createdAt} >= ${dayStart}`));
    const room = 10 - Number(todayPosts?.n ?? 0);
    if (room > 0) {
      const found = await db.select().from(deals).where(and(eq(deals.simulated, false), eq(deals.status, "found"))).orderBy(desc(deals.discountPct)).limit(room);
      for (const d of found) {
        const [open] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.kind, "write_post"), eq(tasks.simulated, false), inArray(tasks.status, ["queued", "running", "review"]), sql`${tasks.input} ->> 'dealId' = ${d.id}`)).limit(1);
        if (open) continue;
        const [row] = await db.insert(tasks).values({ floorId: floor.id, agentId: editor.id, kind: "write_post", title: "Write deal post", status: "queued", priority: 5, input: { dealId: d.id }, simulated: false, createdAt: now, updatedAt: now }).returning({ id: tasks.id });
        await logEvent(db, { taskId: row?.id, agentId: editor.id, floorId: floor.id, type: "created", message: `Write deal post queued: ${d.title.slice(0, 50)}`, at: now });
        created.write_post = (created.write_post ?? 0) + 1;
      }
    }
    await planEngagement(db, now, floor, editor.id, created);
  }

  // Deals older than three days without a post go stale.
  await db.update(deals).set({ status: "expired", updatedAt: now }).where(and(eq(deals.simulated, false), eq(deals.status, "found"), sql`${deals.expiresAt} < ${now}`));
}

// The side effect behind an approved public_post: one message (or poll) to the channel or a group, on its slot, once,
// then the crossposts named on the approval.
export async function publishPost(db: Db, a: typeof approvals.$inferSelect, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  if (a.status !== "approved") return { ok: false, error: "not approved" };
  const content = (a.content ?? {}) as Record<string, unknown>;
  const postId = typeof content.postId === "string" ? content.postId : null;
  const [post] = postId ? await db.select().from(posts).where(eq(posts.id, postId)).limit(1) : await db.select().from(posts).where(eq(posts.approvalId, a.id)).limit(1);
  if (!post) return { ok: false, error: "post row missing" };
  if (post.status === "posted") return { ok: true };
  if (post.scheduledAt && post.scheduledAt.getTime() > now.getTime()) return { ok: false, error: `scheduled for ${post.scheduledAt.toISOString().slice(11, 16)} UTC` };
  const dealsChannel = channelChatId(await clipboardValue(db, "deals_channel"));
  const chat = post.channel.startsWith("telegram:") ? post.channel.slice("telegram:".length) : dealsChannel;
  if (!chat) return { ok: false, error: "Telegram deals channel not on the clipboard (paste the @handle)" };
  const cfg = await getTelegramConfig(db);
  if (!cfg) return { ok: false, error: "Telegram bot token not on the clipboard" };
  const isDeal = post.kind === "deal";
  const postDeals = post.dealIds.length ? await db.select().from(deals).where(inArray(deals.id, post.dealIds)) : [];
  const extra = (post.extra ?? {}) as { poll?: { question: string; options: string[]; quiz: boolean; correct: number | null; explanation: string | null } | null; crossposts?: Record<string, unknown> };

  let messageId: number | null = null;
  let body = post.body;
  if (extra.poll) {
    const poll = extra.poll;
    const res = await telegramCall(cfg.token, "sendPoll", {
      chat_id: chat,
      question: poll.question.slice(0, 300),
      options: poll.options.map((text) => ({ text: text.slice(0, 100) })),
      is_anonymous: true,
      ...(poll.quiz && poll.correct !== null ? { type: "quiz", correct_option_id: poll.correct, ...(poll.explanation ? { explanation: poll.explanation.slice(0, 200) } : {}) } : { type: "regular" }),
    });
    const r = (res.result ?? {}) as { message_id?: number };
    messageId = res.ok && typeof r.message_id === "number" ? r.message_id : null;
  } else {
    body = isDeal ? withDisclosure(post.body, postDeals.some((d) => isAmazonDeal(d))) : post.body;
    if (body !== post.body) await db.update(posts).set({ body, updatedAt: now }).where(eq(posts.id, post.id));
    messageId = await sendNow(cfg.token, chat, body);
  }
  if (!messageId) return { ok: false, error: `${post.channel.startsWith("telegram:") ? "the group" : "the channel"} refused the post: is the bot an admin with Post messages?` };
  await db.update(posts).set({ status: "posted", postedAt: now, telegramMessageId: messageId, updatedAt: now }).where(eq(posts.id, post.id));
  if (isDeal && post.dealIds.length) await db.update(deals).set({ status: "posted", updatedAt: now }).where(inArray(deals.id, post.dealIds));

  // Crossposts: only the destinations the approval named, only for deals and the evening recap.
  const named = Array.isArray(content.destinations) ? (content.destinations as string[]).filter((d): d is Destination => d === "x" || d === "facebook") : [];
  const crossposts: Record<string, SocialResult> = {};
  if (named.length && (isDeal || post.kind === "recap")) {
    const siteBase = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
    const link = isDeal && post.shortCode ? `${siteBase}/go/${post.shortCode}` : `${siteBase}/deals`;
    const channelLink = dealsChannel ? `https://t.me/${dealsChannel.replace(/^@/, "")}` : "";
    const deal = postDeals[0];
    const amazon = postDeals.some((d) => isAmazonDeal(d));
    for (const d of named) {
      if (d === "x") {
        const lines = isDeal && deal
          ? [deal.title, `AED ${Number(deal.price).toFixed(0)}, was AED ${Number(deal.wasPrice).toFixed(0)}, ${Number(deal.discountPct).toFixed(0)} percent off`, link, channelLink ? `More deals daily: ${channelLink}` : "", amazon ? "#ad" : ""]
          : [...body.split("\n").filter((l) => l.trim() && !l.includes(siteBase)), link, channelLink ? `More deals daily: ${channelLink}` : ""];
        crossposts.x = await postToX(db, fitForX(lines));
      } else {
        const message = `${body.split("\n").filter((l) => !l.includes("/go/")).join("\n").trim()}${channelLink ? `\n\nMore deals every day: ${channelLink}` : ""}`;
        crossposts.facebook = await postToFacebook(db, message, link);
      }
    }
    await db.update(posts).set({ extra: { ...extra, crossposts }, updatedAt: now }).where(eq(posts.id, post.id));
  }

  const [publisher] = await db.select().from(agents).where(eq(agents.slug, "deals_publisher")).limit(1);
  if (publisher) {
    const what = isDeal ? "deal post" : String(content.title ?? post.kind);
    await db.insert(tasks).values({ floorId: post.floorId, agentId: publisher.id, kind: "publish_post", title: `Publish ${what}`.slice(0, 60), status: "done", output: { posted: true, postId: post.id, messageId, crossposts }, reviewScore: 7, reviewReason: "Posted on schedule", startedAt: now, finishedAt: now, simulated: false, createdAt: now, updatedAt: now });
    await db.update(agents).set({ tasksDone: publisher.tasksDone + 1, updatedAt: now }).where(eq(agents.id, publisher.id));
    const where = post.channel.startsWith("telegram:") ? "a group" : "the channel";
    await logEvent(db, { agentId: publisher.id, floorId: post.floorId, type: "done", message: `Posted to ${where}: ${String(content.title ?? "deal")}`, data: { postId: post.id }, at: now });
    for (const [d, r] of Object.entries(crossposts)) {
      await logEvent(db, { agentId: publisher.id, floorId: post.floorId, type: r.ok ? "done" : "log", message: r.ok ? `Crossposted to ${d === "x" ? "X" : "Facebook"}` : `Crosspost to ${d === "x" ? "X" : "Facebook"} failed: ${r.error ?? "unknown"}`, data: { postId: post.id }, at: now });
    }
  }
  return { ok: true };
}

// /go/<code>: count the click, hand back the affiliate link.
export async function recordClick(db: Db, code: string, meta: { referrer?: string | null; userAgent?: string | null; country?: string | null }, now = new Date()): Promise<string | null> {
  const [post] = await db.select().from(posts).where(eq(posts.shortCode, code)).limit(1);
  if (!post) return null;
  const dealId = post.dealIds[0] ?? null;
  const [deal] = dealId ? await db.select().from(deals).where(eq(deals.id, dealId)).limit(1) : [];
  const target = deal?.affiliateUrl ?? deal?.url ?? null;
  if (!target) return null;
  const { createHash } = await import("node:crypto");
  const uaHash = meta.userAgent ? createHash("sha256").update(meta.userAgent).digest("hex").slice(0, 16) : null;
  await db.insert(clicks).values({ shortCode: code, postId: post.id, dealId, ts: now, referrer: meta.referrer?.slice(0, 300) ?? null, country: meta.country ?? null, uaHash });
  await db.update(posts).set({ clicks: sql`${posts.clicks} + 1`, updatedAt: now }).where(eq(posts.id, post.id));
  return target;
}

// The public deals page reads the latest posted deals.
export async function latestPostedDeals(db: Db, limit = 40) {
  const rows = await db
    .select({ post: posts, deal: deals })
    .from(posts)
    .innerJoin(deals, sql`${deals.id} = ${posts.dealIds}[1]`)
    .where(and(eq(posts.status, "posted"), eq(posts.simulated, false), eq(posts.kind, "deal")))
    .orderBy(desc(posts.postedAt))
    .limit(limit);
  return rows;
}

// One posted deal by its short code, for the public deal page. Engagement posts and simulated rows never show.
export async function dealPage(db: Db, code: string) {
  const [row] = await db
    .select({ post: posts, deal: deals })
    .from(posts)
    .innerJoin(deals, sql`${deals.id} = ${posts.dealIds}[1]`)
    .where(and(eq(posts.shortCode, code), eq(posts.status, "posted"), eq(posts.simulated, false), eq(posts.kind, "deal")))
    .limit(1);
  return row ?? null;
}

// Every posted deal page for the sitemap, newest first.
export async function sitemapDeals(db: Db, limit = 1000): Promise<Array<{ code: string; postedAt: Date | null }>> {
  const rows = await db
    .select({ code: posts.shortCode, postedAt: posts.postedAt })
    .from(posts)
    .where(and(eq(posts.status, "posted"), eq(posts.simulated, false), eq(posts.kind, "deal")))
    .orderBy(desc(posts.postedAt))
    .limit(limit);
  return rows.filter((r): r is { code: string; postedAt: Date | null } => !!r.code);
}

// Channel health moved to lib/channel.ts (member history, bot rights, share chats).
export { refreshChannelSubscribers } from "@/lib/channel";

export { asc, isNull };
