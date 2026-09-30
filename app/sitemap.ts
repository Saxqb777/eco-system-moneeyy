import type { MetadataRoute } from "next";
import { sitemapDeals } from "@/agents/deals";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

// Only the public deals pages are listed: the game and the client previews stay out of search.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
  let rows: Awaited<ReturnType<typeof sitemapDeals>> = [];
  try {
    rows = await sitemapDeals(getDb());
  } catch {
    rows = [];
  }
  return [
    { url: `${base}/deals`, lastModified: rows[0]?.postedAt ?? new Date(), changeFrequency: "hourly", priority: 1 },
    ...rows.map((r) => ({ url: `${base}/deals/${r.code}`, lastModified: r.postedAt ?? undefined, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
