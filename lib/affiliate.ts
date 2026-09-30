// Affiliate links per store. Amazon.ae takes the Associates tag; other stores use a pasted link template or stay plain.
import type { Db } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";

export interface AffiliateTags {
  amazonAe: string | null;
  noon: string | null;
  other: string | null;
}

export async function affiliateTags(db: Db): Promise<AffiliateTags> {
  return { amazonAe: await clipboardValue(db, "affiliate_amazon_ae"), noon: await clipboardValue(db, "affiliate_noon"), other: await clipboardValue(db, "affiliate_other") };
}

export function affiliateUrl(url: string, store: string, tags: AffiliateTags): { url: string; earns: boolean } {
  try {
    const u = new URL(url);
    if (store === "amazon_ae" || u.hostname.endsWith("amazon.ae")) {
      if (!tags.amazonAe) return { url, earns: false };
      u.searchParams.set("tag", tags.amazonAe);
      return { url: u.toString(), earns: true };
    }
    const template = store === "noon" ? tags.noon : tags.other;
    if (template && template.includes("{url}")) return { url: template.replace("{url}", encodeURIComponent(url)), earns: true };
    return { url, earns: false };
  } catch {
    return { url, earns: false };
  }
}

export function shortCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
