// docledger.site (D067): the company's own website. Until the domain moves to the DocLedger app (D070) the
// Tower answers for it with the company page and the per company previews; the Tower keeps its own address.
import type { Db } from "@/db/client";
import { getSettings } from "@/lib/settings";

export const SITE_HOST = "docledger.site";
const SITE_HOSTS = new Set([SITE_HOST, `www.${SITE_HOST}`]);
const TOWER_URL = "https://the-tower-saxqb777s-projects.vercel.app";

export type SiteRoute = { action: "tower" } | { action: "next" } | { action: "rewrite"; to: string } | { action: "redirect"; to: string };

// What a request on the company domain may see. Anything that is not the site or a preview goes to the home page.
export function siteRoute(host: string | null, pathname: string): SiteRoute {
  const h = (host ?? "").toLowerCase().split(":")[0] ?? "";
  if (!SITE_HOSTS.has(h)) return { action: "tower" };
  if (h !== SITE_HOST) return { action: "redirect", to: `https://${SITE_HOST}${pathname === "/" ? "" : pathname}` };
  if (pathname === "/") return { action: "rewrite", to: "/docledger" };
  if (pathname === "/docledger" || /^\/for\/[a-z0-9]{4,12}$/.test(pathname) || pathname === "/robots.txt" || pathname === "/favicon.ico") return { action: "next" };
  return { action: "redirect", to: `https://${SITE_HOST}/` };
}

// Where an email's link goes (D070): the public demo, set up for that company, once
// settings.docledger_demo_url is set; until then the Tower's own preview page. Never docledger.site, which
// belongs to the DocLedger app.
export function towerBase(): string {
  return (process.env.APP_URL ?? TOWER_URL).replace(/\/$/, "");
}

export async function previewLink(db: Db, code: string): Promise<string> {
  const s = await getSettings(db);
  const demo = s.docledger_demo_url;
  if (typeof demo === "string" && /^https:\/\/[^\s]+$/.test(demo)) return `${demo.replace(/\/$/, "")}/?for=${code}`;
  return `${towerBase()}/for/${code}`;
}

// The company website line the workers may quote, only once the site is live.
export async function siteLine(db: Db): Promise<string> {
  const s = await getSettings(db);
  const v = s.docledger_site_url;
  return typeof v === "string" && /^https:\/\//.test(v) ? `\nCompany website: ${v.replace(/\/$/, "")}` : "";
}
