import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { SITE_HOST } from "@/lib/site";

export const dynamic = "force-dynamic";

// On docledger.site the company page may be read by search engines, the private previews may not.
// On the Tower's own address: the deals pages only. Client previews (/for) are private links and are kept out.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
  if (host === SITE_HOST || host === `www.${SITE_HOST}`) {
    return { rules: [{ userAgent: "*", allow: ["/"], disallow: ["/for/"] }] };
  }
  const base = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/deals", "/deals/"], disallow: ["/", "/for/", "/go/", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
