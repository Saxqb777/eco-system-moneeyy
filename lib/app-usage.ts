// D080: what the Doc Ledger app tells the Tower about the companies the sales floor brought: plan, free month
// end, documents read, members, last activity. Read with the shared DEMO_EVENT_KEY from the app's own address.
import type { Db } from "@/db/client";
import { getSetting } from "@/lib/settings";

export interface AppUsage {
  orgId: string;
  company: string;
  plan: string;
  trialEndsAt: string | null;
  code: string | null;
  since: string | null;
  readsTotal: number;
  reads7d: number;
  lastReadAt: string | null;
  members: number;
  ownTypes: number;
}

export type UsageFetch = (url: string, key: string) => Promise<{ ok: boolean; json: unknown }>;

let usageFetch: UsageFetch = async (url, key) => {
  const res = await fetch(url, { headers: { "x-tower-key": key }, signal: AbortSignal.timeout(8000) });
  return { ok: res.ok, json: await res.json().catch(() => null) };
};

export function setUsageFetch(fn: UsageFetch | null): void {
  usageFetch = fn ?? usageFetch;
}

export async function appBaseUrl(db: Db): Promise<string> {
  const site = await getSetting<string | null>(db, "docledger_site_url", null);
  return (site || "https://docledger.site").replace(/\/$/, "");
}

// Usage for a set of sales codes. Empty when the key is missing or the app cannot be reached; never throws.
export async function appUsageByCode(db: Db, codes: string[]): Promise<Map<string, AppUsage>> {
  const out = new Map<string, AppUsage>();
  const key = process.env.DEMO_EVENT_KEY ?? "";
  const clean = [...new Set(codes.filter((c) => /^[a-z0-9]{4,12}$/.test(c)))].slice(0, 50);
  if (!key || !clean.length) return out;
  try {
    const res = await usageFetch(`${await appBaseUrl(db)}/api/tower/usage?codes=${clean.join(",")}`, key);
    const rows = res.ok && res.json && typeof res.json === "object" ? ((res.json as { orgs?: AppUsage[] }).orgs ?? []) : [];
    for (const r of rows) if (r && typeof r.code === "string") out.set(r.code, { ...r, readsTotal: Number(r.readsTotal ?? 0), reads7d: Number(r.reads7d ?? 0), members: Number(r.members ?? 0), ownTypes: Number(r.ownTypes ?? 0) });
  } catch {
    // the app is asleep or the key is off: the Success agent writes without the numbers
  }
  return out;
}

// One plain line for a Success email or the Company tab.
export function usageLine(u: AppUsage | undefined, now = new Date()): string {
  if (!u) return "No usage numbers from the app yet.";
  const last = u.lastReadAt ? Math.round((now.getTime() - new Date(u.lastReadAt).getTime()) / 3600_000) : null;
  const when = last === null ? "never read a document" : last < 24 ? `last read ${last} hour${last === 1 ? "" : "s"} ago` : `last read ${Math.round(last / 24)} day${Math.round(last / 24) === 1 ? "" : "s"} ago`;
  return `${u.readsTotal} document${u.readsTotal === 1 ? "" : "s"} read in all, ${u.reads7d} in the last 7 days, ${u.members} member${u.members === 1 ? "" : "s"}, ${u.ownTypes} own document type${u.ownTypes === 1 ? "" : "s"}, ${when}. Plan: ${u.plan}${u.trialEndsAt ? `, free month ends ${u.trialEndsAt.slice(0, 10)}` : ""}.`;
}
