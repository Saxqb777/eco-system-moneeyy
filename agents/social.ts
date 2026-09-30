// Social's rhythm on the Growth floor (D074): a plan every seven days, the day's post once the plan says so, the
// Page's numbers once a day, a look for new comments every half hour, and the trust switch to auto posting.
// Nothing reaches Facebook without an approved item: the owner's tap, or auto posting he switched on himself.
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, approvals, floors, posts, taskEvents, tasks } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { asNumber, getSettings, setSetting } from "@/lib/settings";
import { docledgerPage, postToDocledgerPage, readDocledgerPage, replyOnDocledgerPage } from "@/lib/social";
import { dubaiDayStartUtc, dubaiParts } from "@/lib/time";
import type { PageComment, PlanItem, SocialPlan, SocialPostExtra } from "./social-playbooks";

export const SOCIAL_CHANNEL = "facebook_page";
export const SOCIAL_AUTO_DECISION = "Auto post on Facebook";
export const SOCIAL_TRUST_APPROVALS = 10;
export const DEFAULT_POSTS_PER_DAY = 2;
export const PLAN_EVERY_DAYS = 7;
// Posting hours in Dubai: people read in the morning and the evening, nobody wants a post at 3 am.
export const POST_FROM_HOUR = 9;
export const POST_UNTIL_HOUR = 21;
const DAY_MS = 24 * 3600 * 1000;
const COMMENTS_EVERY_MS = 30 * 60 * 1000;

async function logEvent(db: Db, e: { agentId?: string | null; floorId?: string | null; type: string; message: string; at: Date }) {
  await db.insert(taskEvents).values({ agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, createdAt: e.at });
}

// The next moment inside the posting hours: now, or 09:00 Dubai the next morning.
export function nextPostSlot(now: Date): Date {
  const p = dubaiParts(now);
  if (p.hour >= POST_FROM_HOUR && p.hour < POST_UNTIL_HOUR) return now;
  const dayStart = dubaiDayStartUtc(now);
  const nextDay = p.hour >= POST_UNTIL_HOUR ? dayStart.getTime() + DAY_MS : dayStart.getTime();
  return new Date(nextDay + POST_FROM_HOUR * 3600 * 1000);
}

export function inPostingHours(now: Date): boolean {
  const p = dubaiParts(now);
  return p.hour >= POST_FROM_HOUR && p.hour < POST_UNTIL_HOUR;
}

async function postsPerDay(db: Db): Promise<number> {
  const s = await getSettings(db);
  return Math.max(0, Math.floor(asNumber(s.social_posts_per_day, DEFAULT_POSTS_PER_DAY)));
}

async function postedToday(db: Db, now: Date): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`count(*)` })
    .from(posts)
    .where(and(eq(posts.kind, "social"), eq(posts.simulated, false), eq(posts.status, "posted"), gte(posts.postedAt, dubaiDayStartUtc(now))));
  return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Trust: after ten posts approved in a row by the owner himself, the Tower asks once to post on its own.
export async function socialTrust(db: Db): Promise<{ earned: boolean; approvedInARow: number }> {
  const rows = await db
    .select({ status: approvals.status, decidedVia: approvals.decidedVia })
    .from(approvals)
    .where(and(eq(approvals.type, "public_post"), eq(approvals.simulated, false), inArray(approvals.status, ["approved", "rejected"]), sql`${approvals.content} ->> 'social' = 'facebook'`, sql`(${approvals.content} ->> 'replyTo') is null`))
    .orderBy(desc(approvals.decidedAt))
    .limit(SOCIAL_TRUST_APPROVALS * 2);
  let inARow = 0;
  for (const r of rows.filter((x) => x.decidedVia !== "auto").slice(0, SOCIAL_TRUST_APPROVALS)) {
    if (r.status !== "approved") break;
    inARow += 1;
  }
  return { earned: inARow >= SOCIAL_TRUST_APPROVALS, approvedInARow: inARow };
}

export async function maybeRaiseAutoPost(db: Db, floorId: string, now: Date): Promise<boolean> {
  const s = await getSettings(db);
  if (s.social_auto_post === true) return false;
  if (!(await socialTrust(db)).earned) return false;
  const [open] = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.type, "decision"), eq(approvals.summary, SOCIAL_AUTO_DECISION), sql`(${approvals.status} = 'pending' or ${approvals.createdAt} >= ${new Date(now.getTime() - 7 * DAY_MS)})`))
    .limit(1);
  if (open) return false;
  const cap = await postsPerDay(db);
  await raiseApproval(
    db,
    {
      type: "decision",
      summary: SOCIAL_AUTO_DECISION,
      content: { socialAutoPost: true, text: `You approved the last ${SOCIAL_TRUST_APPROVALS} Facebook posts without a rejection. From now on Social posts on its own, at most ${cap} a day, in the posting hours.` },
      riskNote: "Answers to comments still come to you first. Turn auto posting off any time in the Company tab.",
      floorId,
    },
    now,
  );
  return true;
}

export async function autoPostAllowed(db: Db, now: Date): Promise<boolean> {
  const s = await getSettings(db);
  if (s.social_auto_post !== true) return false;
  const [today] = await db
    .select({ n: sql<string>`count(*)` })
    .from(approvals)
    .where(and(eq(approvals.type, "public_post"), eq(approvals.simulated, false), eq(approvals.decidedVia, "auto"), sql`${approvals.content} ->> 'social' = 'facebook'`, gte(approvals.decidedAt, dubaiDayStartUtc(now))));
  return Number(today?.n ?? 0) < (await postsPerDay(db));
}

export async function setAutoPost(db: Db, on: boolean, now = new Date()): Promise<void> {
  await setSetting(db, "social_auto_post", on);
  await logEvent(db, { type: "log", message: on ? "Auto posting on Facebook switched on" : "Auto posting on Facebook switched off", at: now });
}

// ---------------------------------------------------------------------------------------------------------------
// An approved item goes out: a post at the posting hour, an answer to a comment right away.
export async function publishSocial(db: Db, a: typeof approvals.$inferSelect, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  if (a.status !== "approved") return { ok: false, error: "not approved" };
  const content = (a.content ?? {}) as Record<string, unknown>;
  if (typeof content.replyTo === "string") {
    const r = await replyOnDocledgerPage(db, content.replyTo, String(content.body ?? ""));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  const postId = typeof content.postId === "string" ? content.postId : null;
  const [post] = postId ? await db.select().from(posts).where(eq(posts.id, postId)).limit(1) : [];
  if (!post) return { ok: false, error: "post row missing" };
  if (post.status === "posted") return { ok: true };
  if (post.scheduledAt && post.scheduledAt.getTime() > now.getTime()) return { ok: false, error: `scheduled for ${post.scheduledAt.toISOString().slice(11, 16)} UTC` };
  if (!inPostingHours(now)) return { ok: false, error: "waiting for the posting hours in Dubai (09:00 to 21:00)" };
  if ((await postedToday(db, now)) >= (await postsPerDay(db))) return { ok: false, error: "today's posts are done, this one goes tomorrow" };
  const extra = (post.extra ?? {}) as SocialPostExtra;
  const r = await postToDocledgerPage(db, { message: post.body, link: extra.link ?? null, imageUrl: extra.imageUrl ?? null });
  if (!r.ok) return { ok: false, error: r.error };
  await db.update(posts).set({ status: "posted", postedAt: now, extra: { ...extra, externalId: r.id ?? null }, updatedAt: now }).where(eq(posts.id, post.id));
  await logEvent(db, { floorId: post.floorId, type: "output", message: `Posted on the DocLedger Facebook Page: ${post.body.split("\n")[0]!.slice(0, 70)}`, at: now });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// The Page's numbers: reactions, comments, shares and views per post, and the followers.
export async function refreshSocialStats(db: Db, now: Date): Promise<{ posts: number; followers: number | null }> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await db.select().from(posts).where(and(eq(posts.kind, "social"), eq(posts.simulated, false), eq(posts.status, "posted"), gte(posts.postedAt, since)));
  let n = 0;
  for (const p of rows) {
    const extra = (p.extra ?? {}) as SocialPostExtra;
    if (!extra.externalId) continue;
    const base = await readDocledgerPage(db, extra.externalId, { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares" });
    if (!base) continue;
    const count = (v: unknown) => Number(((v ?? {}) as { summary?: { total_count?: number } }).summary?.total_count ?? 0);
    const insights = await readDocledgerPage(db, `${extra.externalId}/insights`, { metric: "post_media_view" });
    const views = Array.isArray(insights?.data) ? Number(((insights!.data as Array<{ values?: Array<{ value?: number }> }>)[0]?.values?.[0]?.value) ?? NaN) : NaN;
    const stats = { reactions: count(base.reactions), comments: count(base.comments), shares: Number(((base.shares ?? {}) as { count?: number }).count ?? 0), views: Number.isFinite(views) ? views : null, at: now.toISOString() };
    await db.update(posts).set({ extra: { ...extra, stats }, updatedAt: now }).where(eq(posts.id, p.id));
    n += 1;
  }
  const page = await readDocledgerPage(db, "{page}", { fields: "followers_count,fan_count" });
  const followers = page ? Number(page.followers_count ?? page.fan_count ?? NaN) : NaN;
  if (Number.isFinite(followers)) await setSetting(db, "social_followers", { count: followers, at: now.toISOString() });
  return { posts: n, followers: Number.isFinite(followers) ? followers : null };
}

// New comments on the last week's posts, not written by the Page itself and not seen before.
export async function newComments(db: Db, now: Date): Promise<PageComment[]> {
  const page = await docledgerPage(db);
  if (!page) return [];
  const s = await getSettings(db);
  const seen = new Set(Array.isArray(s.social_seen_comments) ? (s.social_seen_comments as string[]) : []);
  const rows = await db.select().from(posts).where(and(eq(posts.kind, "social"), eq(posts.simulated, false), eq(posts.status, "posted"), gte(posts.postedAt, new Date(now.getTime() - 7 * DAY_MS)))).limit(14);
  const out: PageComment[] = [];
  for (const p of rows) {
    const extra = (p.extra ?? {}) as SocialPostExtra;
    if (!extra.externalId) continue;
    const res = await readDocledgerPage(db, `${extra.externalId}/comments`, { fields: "id,message,from{id,name}", filter: "stream", limit: "25" });
    for (const c of (Array.isArray(res?.data) ? res!.data : []) as Array<{ id?: string; message?: string; from?: { id?: string; name?: string } }>) {
      if (!c.id || !c.message || seen.has(c.id) || c.from?.id === page.pageId) continue;
      out.push({ commentId: c.id, postText: p.body.split("\n")[0]!.slice(0, 120), from: c.from?.name ?? "", message: c.message.slice(0, 600) });
    }
  }
  return out.slice(0, 8);
}

// ---------------------------------------------------------------------------------------------------------------
async function queue(db: Db, floorId: string, agentId: string, kind: string, title: string, input: Record<string, unknown>, priority: number, now: Date) {
  const [row] = await db.insert(tasks).values({ floorId, agentId, kind, title: title.slice(0, 60), status: "queued", priority, input, simulated: false, createdAt: now, updatedAt: now }).returning({ id: tasks.id });
  await db.insert(taskEvents).values({ taskId: row?.id ?? null, agentId, floorId, type: "created", message: `${title} queued`, createdAt: now });
}

async function openOfKind(db: Db, kind: string): Promise<number> {
  const [r] = await db.select({ n: sql<string>`count(*)` }).from(tasks).where(and(eq(tasks.kind, kind), eq(tasks.simulated, false), inArray(tasks.status, ["queued", "running"])));
  return Number(r?.n ?? 0);
}

export async function advanceSocial(db: Db, floor: typeof floors.$inferSelect, now: Date, created: Record<string, number>): Promise<void> {
  const [social] = await db.select().from(agents).where(eq(agents.slug, "growth_social")).limit(1);
  if (!social || floor.status !== "live") return;
  const s = await getSettings(db);
  const p = dubaiParts(now);
  const bump = (k: string) => (created[k] = (created[k] ?? 0) + 1);
  const connected = !!(await docledgerPage(db));

  // A plan every seven days, from 08:00 Dubai. The plan is made even before the Page is connected, so the owner
  // sees what is coming; posts are written only once there is a Page to post to.
  const plan = s.social_plan as SocialPlan | null;
  const planAge = plan?.at ? now.getTime() - Date.parse(plan.at) : Number.POSITIVE_INFINITY;
  if (p.hour >= 8 && planAge >= PLAN_EVERY_DAYS * DAY_MS - 30 * 60 * 1000 && (await openOfKind(db, "social_plan")) === 0) {
    await queue(db, floor.id, social.id, "social_plan", "Plan this week's Facebook posts", {}, 5, now);
    bump("social_plan");
  }

  if (connected && plan?.items?.length) {
    // Today's item: day index since the plan was made, one draft at a time, no more drafts a day than posts a
    // day. Items from before yesterday are skipped, so a Page connected late does not set off a burst of posts.
    const dayIndex = Math.floor((dubaiDayStartUtc(now).getTime() - dubaiDayStartUtc(new Date(plan.at)).getTime()) / DAY_MS);
    let items: PlanItem[] = plan.items.map((it) => (it.status === "planned" && it.day < dayIndex - 1 ? { ...it, status: "skipped" } : it));
    const due = items.find((it) => it.status === "planned" && it.day <= dayIndex);
    const [draftedToday] = await db.select({ n: sql<string>`count(*)` }).from(posts).where(and(eq(posts.kind, "social"), eq(posts.simulated, false), gte(posts.createdAt, dubaiDayStartUtc(now))));
    if (due && p.hour >= 7 && Number(draftedToday?.n ?? 0) < (await postsPerDay(db)) && (await openOfKind(db, "social_post")) === 0) {
      await queue(db, floor.id, social.id, "social_post", `Facebook post: ${due.theme || "today"}`, { planItemId: due.id, theme: due.theme, idea: due.idea, image: due.image }, 4, now);
      items = items.map((it) => (it.id === due.id ? { ...it, status: "drafting" } : it));
      bump("social_post");
    }
    if (JSON.stringify(items) !== JSON.stringify(plan.items)) await setSetting(db, "social_plan", { ...plan, items });

    // The numbers once a day.
    if (s.pipeline_day_social_stats !== p.dayKey && p.hour >= 20) {
      await setSetting(db, "pipeline_day_social_stats", p.dayKey);
      await refreshSocialStats(db, now);
    }

    // Comments every half hour.
    const lastLook = typeof s.social_comments_at === "string" ? Date.parse(s.social_comments_at) : 0;
    if (now.getTime() - lastLook >= COMMENTS_EVERY_MS) {
      await setSetting(db, "social_comments_at", now.toISOString());
      const fresh = await newComments(db, now);
      if (fresh.length && (await openOfKind(db, "social_replies")) === 0) {
        const seen = Array.isArray(s.social_seen_comments) ? (s.social_seen_comments as string[]) : [];
        await setSetting(db, "social_seen_comments", [...seen, ...fresh.map((c) => c.commentId)].slice(-500));
        await queue(db, floor.id, social.id, "social_replies", `Answer ${fresh.length} Facebook comment${fresh.length === 1 ? "" : "s"}`, { comments: fresh }, 3, now);
        bump("social_replies");
      }
    }
  }

  // Turned down drafts close their post row, so the Company tab shows them as not posted.
  const rejected = await db
    .select({ postId: posts.id })
    .from(posts)
    .innerJoin(approvals, eq(approvals.id, posts.approvalId))
    .where(and(eq(posts.kind, "social"), eq(posts.status, "draft"), eq(approvals.status, "rejected")));
  for (const r of rejected) await db.update(posts).set({ status: "rejected", updatedAt: now }).where(eq(posts.id, r.postId));

  await maybeRaiseAutoPost(db, floor.id, now);
}

// ---------------------------------------------------------------------------------------------------------------
// What the Company tab and Warden see of the Page.
export interface SocialView {
  connected: boolean;
  autoPost: boolean;
  postsPerDay: number;
  trustApprovedInARow: number;
  followers: number | null;
  week: { posts: number; reactions: number; comments: number; shares: number; views: number };
  plan: { at: string; items: Array<{ day: number; theme: string; idea: string; status: string }> } | null;
  recent: Array<{ id: string; text: string; status: string; postedAt: string | null; imageUrl: string | null; stats: SocialPostExtra["stats"] | null }>;
}

export async function socialView(db: Db, now = new Date()): Promise<SocialView> {
  const s = await getSettings(db);
  const recentRows = await db.select().from(posts).where(and(eq(posts.kind, "social"), eq(posts.simulated, false))).orderBy(desc(posts.createdAt)).limit(8);
  const weekRows = await db.select().from(posts).where(and(eq(posts.kind, "social"), eq(posts.simulated, false), isNotNull(posts.postedAt), gte(posts.postedAt, new Date(now.getTime() - 7 * DAY_MS))));
  const week = { posts: weekRows.length, reactions: 0, comments: 0, shares: 0, views: 0 };
  for (const r of weekRows) {
    const st = ((r.extra ?? {}) as SocialPostExtra).stats;
    if (!st) continue;
    week.reactions += st.reactions;
    week.comments += st.comments;
    week.shares += st.shares;
    week.views += st.views ?? 0;
  }
  const plan = s.social_plan as SocialPlan | null;
  const followers = (s.social_followers as { count?: number } | null)?.count;
  return {
    connected: !!(await docledgerPage(db)),
    autoPost: s.social_auto_post === true,
    postsPerDay: await postsPerDay(db),
    trustApprovedInARow: (await socialTrust(db)).approvedInARow,
    followers: typeof followers === "number" ? followers : null,
    week,
    plan: plan?.at ? { at: plan.at, items: plan.items.map((i) => ({ day: i.day, theme: i.theme, idea: i.idea, status: i.status })) } : null,
    recent: recentRows.map((r) => {
      const x = (r.extra ?? {}) as SocialPostExtra;
      return { id: r.id, text: r.body, status: r.status, postedAt: r.postedAt?.toISOString() ?? null, imageUrl: x.imageUrl ?? null, stats: x.stats ?? null };
    }),
  };
}
