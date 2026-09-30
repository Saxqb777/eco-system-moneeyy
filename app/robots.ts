import type { MetadataRoute } from "next";

// Search engines may read the deals pages only. Client previews (/for) are private links and are kept out.
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/deals", "/deals/"], disallow: ["/", "/for/", "/go/", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
