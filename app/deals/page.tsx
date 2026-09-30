import { latestPostedDeals } from "@/agents/deals";
import { getDb } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";
import { channelChatId } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const STORE_LABEL: Record<string, string> = { amazon_ae: "Amazon.ae", noon: "Noon", sharaf_dg: "Sharaf DG", carrefour: "Carrefour", talabat: "Talabat" };

// The public deals page. No passcode, no simulated rows, plain links through /go for click counts.
export default async function DealsPage() {
  const db = getDb();
  let rows: Awaited<ReturnType<typeof latestPostedDeals>> = [];
  let channel: string | null = null;
  try {
    rows = await latestPostedDeals(db, 40);
    channel = channelChatId(await clipboardValue(db, "deals_channel"));
  } catch {
    rows = [];
  }
  return (
    <main className="deals">
      <header className="deals-head">
        <h1>UAE Daily Deals</h1>
        <p>Real discounts on Amazon.ae, Noon, Sharaf DG, Carrefour and Talabat, checked by hand before they are posted. Some links pay us a small commission at no cost to you.</p>
        {channel ? (
          <a className="key" href={`https://t.me/${channel.replace(/^@/, "")}`}>
            Join the Telegram channel
          </a>
        ) : null}
      </header>
      {rows.length === 0 ? <p className="deals-empty">No deals posted yet. The first ones land once the channel is live.</p> : null}
      <ul className="deals-list">
        {rows.map(({ post, deal }) => (
          <li key={post.id} className="deal">
            <div className="deal-store">{STORE_LABEL[deal.store] ?? deal.store}</div>
            <h2>{deal.title}</h2>
            <div className="deal-price">
              <span className="now">AED {Number(deal.price).toFixed(0)}</span>
              <span className="was">AED {Number(deal.wasPrice).toFixed(0)}</span>
              <span className="off">{Number(deal.discountPct).toFixed(0)}% off</span>
            </div>
            <p className="deal-body">{post.body.split("\n").filter((l) => !l.includes("/go/")).join(" ")}</p>
            <a className="key" href={`/go/${post.shortCode}`} rel="nofollow sponsored">
              Get the deal
            </a>
            <div className="deal-meta">Posted {post.postedAt?.toISOString().slice(0, 10)}</div>
          </li>
        ))}
      </ul>
      <footer className="deals-foot">Prices move fast. Check the store page before you buy.</footer>
    </main>
  );
}
