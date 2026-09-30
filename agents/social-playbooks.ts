// Social (D074): the DocLedger Facebook Page. Every seven days Social plans the week's posts, each day it writes
// the day's post with a picture of the real app and a link, and it drafts answers to comments. Posts wait on the
// owner's tap until he switches on auto posting; answers to comments always wait on him.
import { and, desc, eq, sql } from "drizzle-orm";
import { approvals, posts } from "@/db/schema";
import { raiseApproval } from "@/lib/approvals";
import { setSetting, getSettings } from "@/lib/settings";
import { plainDashes } from "@/lib/text";
import { docledgerKnowledge } from "@/config/docledger";
import { currentRoadmap } from "./growth-playbooks";
import { salesFunnel } from "./docledger-autonomy";
import { STYLE, input, logEvent, str, type Playbook } from "./playbook-core";

export const SOCIAL_IMAGES = {
  review: { url: "https://docledger.site/landing/review.jpg", about: "the app reading a shipping line bill: every charge line on screen, checked before saving" },
  records: { url: "https://docledger.site/landing/records.jpg", about: "the records list: every saved bill with its totals, by type and business unit" },
  types: { url: "https://docledger.site/landing/types.jpg", about: "building your own document type: the fields a company wants from its own bills" },
  shipping_bill: { url: "https://docledger.site/samples/shipping-bill.png", about: "a sample shipping line bill, the kind DocLedger reads" },
} as const;
export type SocialImage = keyof typeof SOCIAL_IMAGES | "none";
const IMAGE_KEYS = [...Object.keys(SOCIAL_IMAGES), "none"];

export const SOCIAL_LINKS = { site: "https://docledger.site", demo: "https://demo.docledger.site" } as const;
export type SocialLink = keyof typeof SOCIAL_LINKS | "none";

export const THEMES = ["the problem", "product tip", "behind the scenes", "question to the audience", "UAE finance tip", "demo invite"] as const;

export interface PlanItem {
  id: string;
  day: number; // days after the plan was made
  theme: string;
  idea: string;
  image: SocialImage;
  status: "planned" | "drafting" | "drafted" | "skipped";
}

export interface SocialPlan {
  at: string;
  items: PlanItem[];
  note: string;
}

export interface SocialPostExtra {
  image?: SocialImage;
  imageUrl?: string | null;
  link?: string | null;
  planItemId?: string | null;
  externalId?: string | null;
  stats?: { reactions: number; comments: number; shares: number; views: number | null; at: string };
}

const SOCIAL_SYSTEM = `You are Social at Doc Ledger, a young company in the UAE. You run the company's Facebook Page and write as the company, warm and direct, like a small team that knows the work.
The readers: finance managers, accountants, owners of small and mid sized companies in the UAE, especially logistics, freight forwarding and trading companies that key in bills by hand.
Rules for every post:
- One idea per post, 40 to 110 words, short lines, no wall of hashtags (at most three, only if they help), no emojis in a row.
- Every claim comes from the product facts below. Never invent customers, numbers, results, awards or reviews. Never name a prospect or a company that wrote to us.
- No price. The first month is free and the demo needs no signup: you may say both.
- End with one clear next step: try the demo, reply with a question, or send one of your bills to see it read.
${docledgerKnowledge()}
${STYLE}`;

async function recentSocialPosts(db: Parameters<Playbook["prepare"]>[1]["db"], limit = 10) {
  return db.select().from(posts).where(and(eq(posts.kind, "social"), eq(posts.simulated, false))).orderBy(desc(posts.createdAt)).limit(limit);
}

function statLine(p: typeof posts.$inferSelect): string {
  const x = (p.extra ?? {}) as SocialPostExtra;
  const st = x.stats;
  const nums = st ? `${st.reactions} reactions, ${st.comments} comments, ${st.shares} shares${st.views !== null ? `, ${st.views} views` : ""}` : p.status === "posted" ? "no numbers yet" : p.status;
  return `- ${p.body.split("\n")[0]!.slice(0, 90)} (${nums})`;
}

export const socialPlan: Playbook = {
  kind: "social_plan",
  webSearchMaxUses: 2,
  maxTokens: 2500,
  system: `${SOCIAL_SYSTEM}
Now plan the next seven days of Facebook posts, one a day. Mix the themes (${THEMES.join(", ")}), and lean towards what did well last week. You may search the web once or twice for one timely UAE topic that matters to finance teams (VAT, e invoicing, corporate tax deadlines, port or shipping news); use it only with what you actually found. For each day pick the picture that fits from this list, or none: ${Object.entries(SOCIAL_IMAGES).map(([k, v]) => `${k} (${v.about})`).join("; ")}.`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["posts", "note"],
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["day", "theme", "idea", "image"],
          properties: { day: { type: "integer" }, theme: { type: "string" }, idea: { type: "string" }, image: { type: "string", enum: IMAGE_KEYS } },
        },
      },
      note: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const recent = await recentSocialPosts(ctx.db, 14);
    const funnel = await salesFunnel(ctx.db, ctx.now);
    const roadmap = (await currentRoadmap(ctx.db)).slice(0, 4);
    const focus = str(input(task).instructions, 600);
    return {
      user: `${focus ? `Focus from the Head of Growth: ${focus}\n` : ""}Last posts and how they did:\n${recent.map(statLine).join("\n") || "- none yet, this is the first week"}\nThis week in sales: ${funnel.sentWeek} emails sent, ${funnel.repliesWeek} replies.\nWhat Product is working on: ${roadmap.map((r) => r.title).join("; ") || "nothing listed"}\n\nPlan the next seven days (day 0 is today) and return the JSON object.`,
    };
  },
  async absorb(_task, output, ctx) {
    const raw = Array.isArray(output.posts) ? output.posts : [];
    const items: PlanItem[] = raw.slice(0, 7).map((r, i) => {
      const x = (r ?? {}) as Record<string, unknown>;
      const image = IMAGE_KEYS.includes(String(x.image)) ? (String(x.image) as SocialImage) : "none";
      const day = Math.max(0, Math.min(6, Math.floor(Number(x.day ?? i)) || 0));
      return { id: `${ctx.now.getTime().toString(36)}_${i}`, day, theme: plainDashes(str(x.theme, 60)), idea: plainDashes(str(x.idea, 400)), image, status: "planned" as const };
    }).filter((p) => p.idea);
    const plan: SocialPlan = { at: ctx.now.toISOString(), items, note: plainDashes(str(output.note, 400)) };
    await setSetting(ctx.db, "social_plan", plan);
    return { summary: `Planned ${items.length} Facebook post${items.length === 1 ? "" : "s"} for the week`, extra: { planned: items.length } };
  },
};

export const socialPost: Playbook = {
  kind: "social_post",
  webSearchMaxUses: 0,
  maxTokens: 1200,
  system: `${SOCIAL_SYSTEM}
Now write today's Facebook post from the plan. Choose the link: demo (the demo company, no signup), site (the company page) or none. Choose the picture from: ${Object.entries(SOCIAL_IMAGES).map(([k, v]) => `${k} (${v.about})`).join("; ")}, or none.`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["message", "link", "image"],
    properties: { message: { type: "string" }, link: { type: "string", enum: ["demo", "site", "none"] }, image: { type: "string", enum: IMAGE_KEYS } },
  },
  async prepare(task, ctx) {
    const i = input(task);
    const recent = await recentSocialPosts(ctx.db, 8);
    // What the owner said when he turned posts down: Social learns his taste from it.
    const turnedDown = await ctx.db
      .select({ feedback: approvals.feedback })
      .from(approvals)
      .where(and(eq(approvals.type, "public_post"), eq(approvals.status, "rejected"), eq(approvals.simulated, false), sql`${approvals.content} ->> 'social' = 'facebook'`))
      .orderBy(desc(approvals.decidedAt))
      .limit(5);
    const notes = turnedDown.map((r) => str(r.feedback, 200)).filter(Boolean);
    return {
      user: `Today's plan: theme ${str(i.theme, 60) || "free"}. Idea: ${str(i.idea, 400)}. Suggested picture: ${str(i.image, 20) || "none"}.\n${notes.length ? `The owner's notes on posts he turned down, follow them:\n${notes.map((n) => `- ${n}`).join("\n")}\n` : ""}Recent posts, do not repeat them:\n${recent.map((p) => `- ${p.body.split("\n")[0]!.slice(0, 100)}`).join("\n") || "- none yet"}\n\nWrite the post and return the JSON object.`,
    };
  },
  async absorb(task, output, ctx) {
    const { autoPostAllowed, nextPostSlot, SOCIAL_CHANNEL } = await import("./social");
    const i = input(task);
    const message = plainDashes(str(output.message, 2000));
    if (!message) return { summary: "No post written" };
    const image = (IMAGE_KEYS.includes(String(output.image)) ? String(output.image) : "none") as SocialImage;
    const linkKey = String(output.link) as SocialLink;
    const link = linkKey === "demo" || linkKey === "site" ? SOCIAL_LINKS[linkKey] : null;
    const imageUrl = image !== "none" ? SOCIAL_IMAGES[image].url : null;
    const scheduledAt = nextPostSlot(ctx.now);
    const extra: SocialPostExtra = { image, imageUrl, link, planItemId: str(i.planItemId, 60) || null };
    const [post] = await ctx.db
      .insert(posts)
      .values({ floorId: ctx.floorId, kind: "social", body: message, channel: SOCIAL_CHANNEL, status: "draft", scheduledAt, extra, simulated: false, createdAt: ctx.now, updatedAt: ctx.now })
      .returning({ id: posts.id });
    const auto = await autoPostAllowed(ctx.db, ctx.now);
    const approval = await raiseApproval(
      ctx.db,
      {
        type: "public_post",
        summary: `Facebook post: ${message.split("\n")[0]!.slice(0, 70)}`,
        content: { social: "facebook", postId: post?.id, body: link ? `${message}\n\n${link}` : message, imageUrl, link },
        previewUrl: imageUrl,
        riskNote: auto ? "Auto posting is on: this goes out on its own at the next posting hour." : "Goes to the DocLedger Facebook Page at the next posting hour in Dubai (09:00 to 21:00), with the picture shown.",
        taskId: task.id,
        agentId: ctx.agentId,
        floorId: ctx.floorId,
        autoApproved: auto,
      },
      ctx.now,
    );
    if (post) await ctx.db.update(posts).set({ approvalId: approval.id, status: auto ? "approved" : "draft", updatedAt: ctx.now }).where(eq(posts.id, post.id));
    const planItemId = str(i.planItemId, 60);
    if (planItemId) {
      const s = await getSettings(ctx.db);
      const plan = s.social_plan as SocialPlan | null;
      if (plan?.items) await setSetting(ctx.db, "social_plan", { ...plan, items: plan.items.map((p) => (p.id === planItemId ? { ...p, status: "drafted" } : p)) });
    }
    await logEvent(ctx.db, { taskId: task.id, agentId: ctx.agentId, floorId: ctx.floorId, type: "output", message: `Social wrote a Facebook post${auto ? ", posting on its own" : ", waiting on the owner"}`, at: ctx.now });
    return { summary: `Wrote a Facebook post${auto ? " (auto)" : ""}: ${message.split("\n")[0]!.slice(0, 60)}`, extra: { postId: post?.id ?? null, auto } };
  },
};

export interface PageComment {
  commentId: string;
  postText: string;
  from: string;
  message: string;
}

export const socialReplies: Playbook = {
  kind: "social_replies",
  webSearchMaxUses: 0,
  maxTokens: 1500,
  system: `${SOCIAL_SYSTEM}
Now answer comments on the Page. Be brief (one to three sentences), friendly and useful. A question about the product gets a straight answer from the facts; a hard question or anything about price gets an invitation to message us or try the demo. Skip spam, insults and comments that need no answer (a like, an emoji, a tag of a friend): set skip to true and say why.`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["replies"],
    properties: {
      replies: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["commentId", "reply", "skip", "why"], properties: { commentId: { type: "string" }, reply: { type: "string" }, skip: { type: "boolean" }, why: { type: "string" } } },
      },
    },
  },
  async prepare(task) {
    const comments = (Array.isArray(input(task).comments) ? input(task).comments : []) as PageComment[];
    if (!comments.length) return { skip: "no comments to answer" };
    return {
      user: `Comments waiting:\n${comments.map((c) => `- id ${c.commentId}, on the post "${c.postText.slice(0, 80)}", ${c.from || "someone"} wrote: ${c.message.slice(0, 400)}`).join("\n")}\n\nReturn the JSON object with one entry per comment.`,
    };
  },
  async absorb(task, output, ctx) {
    const comments = (Array.isArray(input(task).comments) ? input(task).comments : []) as PageComment[];
    const byId = new Map(comments.map((c) => [c.commentId, c]));
    let raised = 0;
    for (const r of Array.isArray(output.replies) ? output.replies : []) {
      const x = (r ?? {}) as Record<string, unknown>;
      const c = byId.get(str(x.commentId, 80));
      const reply = plainDashes(str(x.reply, 800));
      if (!c || x.skip === true || !reply) continue;
      await raiseApproval(
        ctx.db,
        {
          type: "public_post",
          summary: `Facebook reply to ${c.from || "a comment"}`,
          content: { social: "facebook", replyTo: c.commentId, body: reply, comment: c.message.slice(0, 400), from: c.from },
          riskNote: `Their comment: "${c.message.slice(0, 200)}". Answers to comments always wait on you.`,
          taskId: task.id,
          agentId: ctx.agentId,
          floorId: ctx.floorId,
        },
        ctx.now,
      );
      raised += 1;
    }
    return { summary: raised ? `Drafted ${raised} answer${raised === 1 ? "" : "s"} to Facebook comments` : "No comment needed an answer", extra: { raised } };
  },
};

export const SOCIAL_PLAYBOOKS: Record<string, Playbook> = {
  social_plan: socialPlan,
  social_post: socialPost,
  social_replies: socialReplies,
};
