// docledger.site (D067): the company's own website. On that domain only the DocLedger page and the per company
// previews exist; the Tower stays on its own address. Preview links in emails use the site once it is live
// (settings.docledger_site_url), the Tower address until then.
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

// The address DocLedger's emails link to: the company site when it is live, the Tower otherwise.
export async function docledgerBase(db: Db): Promise<string> {
  const s = await getSettings(db);
  const v = s.docledger_site_url;
  if (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v)) return v.replace(/\/$/, "");
  return (process.env.APP_URL ?? TOWER_URL).replace(/\/$/, "");
}

// The company website line the workers may quote, only once the site is live.
export async function siteLine(db: Db): Promise<string> {
  const s = await getSettings(db);
  const v = s.docledger_site_url;
  return typeof v === "string" && /^https:\/\//.test(v) ? `\nCompany website: ${v.replace(/\/$/, "")}` : "";
}
