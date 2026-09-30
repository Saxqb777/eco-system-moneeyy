import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { dealPage } from "@/agents/deals";
import { getDb } from "@/db/client";
import { AMAZON_DISCLOSURE, isAmazonDeal } from "@/lib/affiliate";
import { clipboardValue } from "@/lib/clipboard";
import { channelChatId } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const STORE_LABEL: Record<string, string> = { amazon_ae: "Amazon.ae", noon: "Noon", sharaf_dg: "Sharaf DG", carrefour: "Carrefour", talabat: "Talabat" };
const base = () => (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");

async function load(code: string) {
  if (!/^[a-z0-9]{4,12}$/.test(code)) return null;
  try {
    return await dealPage(getDb(), code);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const row = await load(code);
  if (!row) return { title: "Deal not found | UAE Daily Deals" };
  const { deal } = row;
  const store = STORE_LABEL[deal.store] ?? deal.store;
  const title = `${deal.title}: AED ${Number(deal.price).toFixed(0)}, ${Number(deal.discountPct).toFixed(0)}% off on ${store} | UAE Daily Deals`;
  const description = `${deal.title} is AED ${Number(deal.price).toFixed(0)} on ${store}, down from AED ${Number(deal.wasPrice).toFixed(0)}. Checked deals for shoppers in the UAE, posted daily.`;
  const url = `${base()}/deals/${code}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: "article", siteName: "UAE Daily Deals", ...(deal.imageUrl ? { images: [deal.imageUrl] } : {}) } };
}

// One deal on its own page, so search engines can send people to it and on to the Telegram channel.
export default async function DealPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const row = await load(code);
  if (!row) notFound();
  const { post, deal } = row;
  let channel: string | null = null;
  try {
    channel = channelChatId(await clipboardValue(getDb(), "deals_channel"));
  } catch {
    channel = null;
  }
  const text = post.body.split("\n").filter((l) => l.trim() && !l.includes("/go/") && l.trim() !== AMAZON_DISCLOSURE);
  return (
    <main className="deals">
      <header className="deals-head">
        <a className="deals-back" href="/deals">
          All deals
        </a>
        <h1>{deal.title}</h1>
        <p>Checked by hand before it was posted. Prices move fast: the store page has the final price.</p>
      </header>
      <article className="deal deal-single">
        <div className="deal-store">{STORE_LABEL[deal.store] ?? deal.store}</div>
        <div className="deal-price">
          <span className="now">AED {Number(deal.price).toFixed(0)}</span>
          <span className="was">AED {Number(deal.wasPrice).toFixed(0)}</span>
          <span className="off">{Number(deal.discountPct).toFixed(0)}% off</span>
        </div>
        {text.map((l, i) => (
          <p key={i} className="deal-body">
            {l}
          </p>
        ))}
        <a className="key" href={`/go/${post.shortCode}`} rel="nofollow sponsored">
          Get the deal
        </a>
        <div className="deal-meta">Posted {post.postedAt?.toISOString().slice(0, 10)}</div>
      </article>
      {channel ? (
        <section className="deals-join">
          <h2>New deals every day</h2>
          <p>Join the Telegram channel and get each deal the moment it is checked.</p>
          <a className="key" href={`https://t.me/${channel.replace(/^@/, "")}`}>
            Join the Telegram channel
          </a>
        </section>
      ) : null}
      <footer className="deals-foot">{isAmazonDeal(deal) ? AMAZON_DISCLOSURE : "Some links pay us a small commission at no cost to you."}</footer>
    </main>
  );
}
