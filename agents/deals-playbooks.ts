// Deals Engine playbooks: Scout fetches real store pages, Editor writes short posts with tracked links.
import { and, desc, eq, sql } from "drizzle-orm";
import { deals, floors, posts } from "@/db/schema";
import { affiliateTags, affiliateUrl, isAmazonDeal, shortCode, withDisclosure } from "@/lib/affiliate";
import { raiseApproval } from "@/lib/approvals";
import { channelChatId } from "@/lib/telegram";
import { clipboardValue } from "@/lib/clipboard";
import { STYLE, input, logEvent, num, str, type Playbook } from "./playbook-core";

const STORE_LABEL: Record<string, string> = { amazon_ae: "Amazon.ae", noon: "Noon", sharaf_dg: "Sharaf DG", carrefour: "Carrefour", talabat: "Talabat" };
const STORE_HOSTS: Record<string, string> = { amazon_ae: "amazon.ae", noon: "noon.com", sharaf_dg: "sharafdg.com", carrefour: "carrefouruae.com", talabat: "talabat.com" };

export function dealKey(store: string, url: string, title: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    const asin = path.match(/\/dp\/([a-z0-9]{10})/)?.[1];
    return `${store}|${asin ?? (path.slice(0, 80) || title.toLowerCase().slice(0, 60))}`;
  } catch {
    return `${store}|${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
  }
}

const findDeals: Playbook = {
  kind: "find_deals",
  webSearchMaxUses: 2,
  webFetchMaxUses: 8,
  maxTokens: 3500,
  system: `You are Scout on the Deals Engine floor of The Tower. Find real, current discounts on UAE online stores: Amazon.ae first, then Noon, Sharaf DG, Carrefour UAE and Talabat. Fetch the store deal pages directly with the fetch tool (for example https://www.amazon.ae/deals, https://www.noon.com/uae-en/deals/, https://uae.sharafdg.com/deals/) and read the prices from the page. Use web search only when a page will not load.
Return up to 20 deals you actually saw, each with the product page URL, the price now, the price before, and the discount. Skip anything under 15 percent off, anything already in the known list, and anything with no visible before price. Prefer useful everyday products: electronics, home, kitchen, baby, groceries in bulk.
${STYLE}`,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["deals", "note"],
    properties: {
      deals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["store", "title", "url", "price", "wasPrice", "discountPct", "category", "imageUrl"],
          properties: {
            store: { type: "string", enum: ["amazon_ae", "noon", "sharaf_dg", "carrefour", "talabat"] },
            title: { type: "string" },
            url: { type: "string" },
            price: { type: "number" },
            wasPrice: { type: "number" },
            discountPct: { type: "number" },
            category: { type: "string" },
            imageUrl: { type: "string", description: "product image URL or empty" },
          },
        },
      },
      note: { type: "string" },
    },
  },
  async prepare(task, ctx) {
    const recent = await ctx.db.select({ title: deals.title }).from(deals).where(eq(deals.simulated, false)).orderBy(desc(deals.createdAt)).limit(120);
    const focus = str(input(task).instructions) || "Amazon.ae deals page first, then Noon.";
    return { user: `Focus from Warden: ${focus}\nToday: ${ctx.now.toISOString().slice(0, 10)}\nKnown already (skip): ${recent.map((r) => r.title).join("; ") || "nothing yet"}\n\nFind today's deals and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const rows = Array.isArray(output.deals) ? output.deals : [];
    const tags = await affiliateTags(ctx.db);
    let inserted = 0;
    let skipped = 0;
    for (const raw of rows) {
      const r = (raw ?? {}) as Record<string, unknown>;
      const store = str(r.store, 20);
      const title = str(r.title, 140);
      const url = str(r.url, 500);
      const price = num(r.price, 0);
      const was = num(r.wasPrice, 0);
      const host = STORE_HOSTS[store];
      if (!store || !title || !url || price <= 0 || was <= price || !host || !url.includes(host)) {
        skipped += 1;
        continue;
      }
      const discount = Math.round(((was - price) / was) * 100);
      if (discount < 15) {
        skipped += 1;
        continue;
      }
      const aff = affiliateUrl(url, store, tags);
      const [ins] = await ctx.db
        .insert(deals)
        .values({ floorId: ctx.floorId, store, title, url, affiliateUrl: aff.url, price: price.toFixed(2), wasPrice: was.toFixed(2), discountPct: String(discount), currency: "AED", category: str(r.category, 40) || null, imageUrl: str(r.imageUrl, 500) || null, foundByTaskId: task.id, status: "found", dedupeKey: dealKey(store, url, title), expiresAt: new Date(ctx.now.getTime() + 3 * 24 * 3600 * 1000), simulated: false, createdAt: ctx.now, updatedAt: ctx.now })
        .onConflictDoNothing()
        .returning({ id: deals.id });
      if (ins) inserted += 1;
      else skipped += 1;
    }
    return { summary: `Found ${inserted} deal${inserted === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped` : ""}`, extra: { found: inserted, skipped, note: str(output.note, 300) } };
  },
};

const writePost: Playbook = {
  kind: "write_post",
  webSearchMaxUses: 0,
  maxTokens: 800,
  system: `You are Editor on the Deals Engine floor of The Tower. Write one short Telegram post for one deal. Line 1: the product, plain. Line 2: the price now, the price before, the percent off, in AED. Line 3: one honest reason it is worth it or who it is for. No emojis, no exclamation marks, no fluff, no hashtags, under 45 words. Do not include the link, the Tower adds it.
${STYLE}`,
  schema: { type: "object", additionalProperties: false, required: ["title", "body"], properties: { title: { type: "string", description: "short headline, under 8 words" }, body: { type: "string" } } },
  async prepare(task, ctx) {
    const dealId = str(input(task).dealId);
    const [deal] = dealId ? await ctx.db.select().from(deals).where(eq(deals.id, dealId)).limit(1) : [];
    if (!deal) return { skip: "No deal attached to this task" };
    if (deal.status !== "found" && deal.status !== "selected") return { skip: `Deal is already ${deal.status}` };
    const feedback = str(input(task).feedback);
    return { user: `Store: ${STORE_LABEL[deal.store] ?? deal.store}\nProduct: ${deal.title}\nPrice now: AED ${Number(deal.price).toFixed(0)}\nPrice before: AED ${Number(deal.wasPrice).toFixed(0)}\nDiscount: ${Number(deal.discountPct).toFixed(0)} percent\nCategory: ${deal.category ?? "general"}\n${feedback ? `Warden's feedback on the last draft: ${feedback}\n` : ""}\nWrite the post and return the JSON object.` };
  },
  async absorb(task, output, ctx) {
    const dealId = str(input(task).dealId);
    const [deal] = await ctx.db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
    if (!deal) return { summary: "Deal vanished" };
    const [floor] = deal.floorId ? await ctx.db.select().from(floors).where(eq(floors.id, deal.floorId)).limit(1) : [];
    const base = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
    const code = shortCode();
    const title = str(output.title, 80) || deal.title;
    const text = str(output.body, 600);
    const body = withDisclosure(`${text}\n${base}/go/${code}`, isAmazonDeal(deal));
    const channel = channelChatId(await clipboardValue(ctx.db, "deals_channel")) ?? "";
    const [row] = await ctx.db.insert(posts).values({ floorId: deal.floorId, kind: "deal", dealIds: [deal.id], body, channel: "telegram_channel", status: "draft", shortCode: code, scheduledAt: await nextSlot(ctx.db, ctx.now), simulated: false, createdAt: ctx.now, updatedAt: ctx.now }).returning({ id: posts.id });
    const auto = !!floor?.autoApprove;
    const { id: approvalId } = await raiseApproval(ctx.db, {
      type: "public_post",
      summary: `Post to the deals channel: ${title}`,
      content: { body, store: deal.store, dealId: deal.id, postId: row?.id ?? null, title, affiliateUrl: deal.affiliateUrl ?? deal.url, channel },
      riskNote: deal.affiliateUrl && deal.affiliateUrl !== deal.url ? "Public post on the Telegram channel with an affiliate link." : "Public post on the Telegram channel with a plain link (no affiliate id for this store yet).",
      taskId: task.id,
      agentId: ctx.agentId,
      floorId: ctx.floorId,
      autoApproved: auto,
    }, ctx.now);
    if (row) await ctx.db.update(posts).set({ approvalId, status: auto ? "approved" : "draft", updatedAt: ctx.now }).where(eq(posts.id, row.id));
    await ctx.db.update(deals).set({ status: "selected", updatedAt: ctx.now }).where(eq(deals.id, deal.id));
    await logEvent(ctx.db, { taskId: task.id, agentId: ctx.agentId, floorId: ctx.floorId, type: "log", message: auto ? `Post auto approved (floor rule): ${title}` : `Post sent to the red phone: ${title}`, at: ctx.now });
    return { summary: `Post drafted: ${title}`, extra: { title, dealId: deal.id, autoApproved: auto } };
  },
};

// Posts spread from 10:00 to 22:00 Dubai, one an hour, next free slot after now.
async function nextSlot(db: Parameters<Playbook["prepare"]>[1]["db"], now: Date): Promise<Date> {
  const dubaiNow = new Date(now.getTime() + 4 * 3600 * 1000);
  const day = new Date(Date.UTC(dubaiNow.getUTCFullYear(), dubaiNow.getUTCMonth(), dubaiNow.getUTCDate()));
  const [taken] = await db.select({ n: sql<string>`count(*)` }).from(posts).where(and(eq(posts.simulated, false), sql`${posts.scheduledAt} >= ${new Date(day.getTime() - 4 * 3600 * 1000)}`));
  const used = Number(taken?.n ?? 0);
  let hour = Math.max(10, dubaiNow.getUTCHours() + 1) + used;
  let dayOffset = 0;
  while (hour > 22) {
    hour -= 13;
    dayOffset += 1;
  }
  const slotUtc = day.getTime() + dayOffset * 24 * 3600 * 1000 + (hour - 4) * 3600 * 1000;
  return new Date(Math.max(slotUtc, now.getTime()));
}

export const DEALS_PLAYBOOKS: Record<string, Playbook> = { find_deals: findDeals, write_post: writePost };
