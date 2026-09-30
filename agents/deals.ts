// Deals Engine floor: the day's scout run, editor posts, and publishing approved posts to the channel on schedule.
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, approvals, clicks, deals, floors, posts, taskEvents, tasks } from "@/db/schema";
import { clipboardValue } from "@/lib/clipboard";
import { getSettings, setSetting } from "@/lib/settings";
import { channelChatId, getTelegramConfig, sendNow } from "@/lib/telegram";
import { dubaiParts } from "@/lib/time";
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

  if (editor) {
    const dayStart = new Date(now.getTime() - ((p.hour * 60 + p.minute) * 60 * 1000));
    const [todayPosts] = await db.select({ n: sql<string>`count(*)` }).from(posts).where(and(eq(posts.simulated, false), sql`${posts.createdAt} >= ${dayStart}`));
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
  }

  // Deals older than three days without a post go stale.
  await db.update(deals).set({ status: "expired", updatedAt: now }).where(and(eq(deals.simulated, false), eq(deals.status, "found"), sql`${deals.expiresAt} < ${now}`));
}

// The side effect behind an approved public_post: one message to the channel, on its slot, once.
export async function publishPost(db: Db, a: typeof approvals.$inferSelect, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  if (a.status !== "approved") return { ok: false, error: "not approved" };
  const content = (a.content ?? {}) as Record<string, unknown>;
  const postId = typeof content.postId === "string" ? content.postId : null;
  const [post] = postId ? await db.select().from(posts).where(eq(posts.id, postId)).limit(1) : await db.select().from(posts).where(eq(posts.approvalId, a.id)).limit(1);
  if (!post) return { ok: false, error: "post row missing" };
  if (post.status === "posted") return { ok: true };
  if (post.scheduledAt && post.scheduledAt.getTime() > now.getTime()) return { ok: false, error: `scheduled for ${post.scheduledAt.toISOString().slice(11, 16)} UTC` };
  const channel = channelChatId(await clipboardValue(db, "deals_channel"));
  if (!channel) return { ok: false, error: "Telegram deals channel not on the clipboard (paste the @handle)" };
  const cfg = await getTelegramConfig(db);
  if (!cfg) return { ok: false, error: "Telegram bot token not on the clipboard" };
  const messageId = await sendNow(cfg.token, channel, post.body);
  if (!messageId) return { ok: false, error: "the channel refused the post: is the bot an admin with Post messages?" };
  await db.update(posts).set({ status: "posted", postedAt: now, telegramMessageId: messageId, updatedAt: now }).where(eq(posts.id, post.id));
  if (post.dealIds.length) await db.update(deals).set({ status: "posted", updatedAt: now }).where(inArray(deals.id, post.dealIds));
  const [publisher] = await db.select().from(agents).where(eq(agents.slug, "deals_publisher")).limit(1);
  if (publisher) {
    await db.insert(tasks).values({ floorId: post.floorId, agentId: publisher.id, kind: "publish_post", title: "Publish deal post", status: "done", output: { posted: true, postId: post.id, messageId }, reviewScore: 7, reviewReason: "Posted on schedule", startedAt: now, finishedAt: now, simulated: false, createdAt: now, updatedAt: now });
    await db.update(agents).set({ tasksDone: publisher.tasksDone + 1, updatedAt: now }).where(eq(agents.id, publisher.id));
    await logEvent(db, { agentId: publisher.id, floorId: post.floorId, type: "done", message: `Posted to the channel: ${String(content.title ?? "deal")}`, data: { postId: post.id }, at: now });
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
    .where(and(eq(posts.status, "posted"), eq(posts.simulated, false)))
    .orderBy(desc(posts.postedAt))
    .limit(limit);
  return rows;
}

// Subscriber count from Telegram, refreshed once a day for the floor's goal metric.
export async function refreshChannelSubscribers(db: Db, now = new Date()): Promise<{ status: string; count?: number }> {
  const settingsMap = await getSettings(db);
  const p = dubaiParts(now);
  if (settingsMap.channel_subscribers_day === p.dayKey) return { status: "fresh" };
  const channel = channelChatId(await clipboardValue(db, "deals_channel"));
  const cfg = await getTelegramConfig(db);
  if (!channel || !cfg) return { status: "skipped" };
  const { telegramCall } = await import("@/lib/telegram");
  const res = await telegramCall(cfg.token, "getChatMemberCount", { chat_id: channel });
  if (!res.ok || typeof res.result !== "number") return { status: "failed" };
  await setSetting(db, "channel_subscribers", res.result);
  await setSetting(db, "channel_subscribers_day", p.dayKey);
  return { status: "updated", count: res.result };
}

export { asc, isNull };
