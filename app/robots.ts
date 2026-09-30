import type { MetadataRoute } from "next";

// The deals pages only. Client previews (/for) are private links and are kept out. docledger.site is served by
// the DocLedger app since 2026-09-30 (D070) and has its own robots.
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/deals", "/deals/"], disallow: ["/", "/for/", "/go/", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
