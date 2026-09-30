// Crossposting to the owner's own X account and Facebook Page. Credentials live on the clipboard, and only the
// destinations named on the approved item are used, so the approval always says where a post will appear.
import { createHmac, randomBytes } from "node:crypto";
import type { Db } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";

export type Destination = "x" | "facebook";
export const GRAPH_VERSION = "v23.0";
const X_TWEETS = "https://api.x.com/2/tweets";

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

export function parseXCredentials(raw: string | null): XCredentials | null {
  const parts = (raw ?? "").split(/[\s,|]+/).filter(Boolean);
  if (parts.length !== 4) return null;
  const [apiKey, apiSecret, accessToken, accessSecret] = parts as [string, string, string, string];
  return { apiKey, apiSecret, accessToken, accessSecret };
}

export function parseFacebookPage(raw: string | null): { pageId: string; token: string } | null {
  const parts = (raw ?? "").split(/[\s,|]+/).filter(Boolean);
  if (parts.length !== 2 || !/^\d{5,25}$/.test(parts[0]!)) return null;
  return { pageId: parts[0]!, token: parts[1]! };
}

export async function socialDestinations(db: Db): Promise<Destination[]> {
  const out: Destination[] = [];
  if (parseXCredentials(await clipboardValue(db, "x_credentials"))) out.push("x");
  if (parseFacebookPage(await clipboardValue(db, "facebook_page"))) out.push("facebook");
  return out;
}

export function destinationLabel(d: Destination[]): string {
  const names = d.map((x) => (x === "x" ? "X" : "Facebook"));
  return names.length ? ` Also goes to ${names.join(" and ")}.` : "";
}

// Percent encoding as OAuth 1.0a wants it (RFC 3986).
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function oauth1Header(method: string, url: string, c: XCredentials, nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000).toString()): string {
  const params: Record<string, string> = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: c.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k]!)}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${enc(url)}&${enc(paramString)}`;
  const signature = createHmac("sha1", `${enc(c.apiSecret)}&${enc(c.accessSecret)}`).update(baseString).digest("base64");
  const all = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(all)
    .sort()
    .map((k) => `${enc(k)}="${enc(all[k as keyof typeof all]!)}"`)
    .join(", ")}`;
}

// X counts every link as 23 characters. Lines are kept whole where possible; the first line is trimmed to fit.
export function fitForX(lines: string[], limit = 280): string {
  const weight = (s: string) => s.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
  const text = lines.filter(Boolean).join("\n");
  if (weight(text) <= limit) return text;
  const [first = "", ...rest] = lines.filter(Boolean);
  const restText = rest.join("\n");
  const room = limit - weight(restText) - 2;
  if (room < 10) return rest.join("\n").slice(0, limit);
  return `${first.slice(0, room - 3).trimEnd()}...\n${restText}`;
}

export interface SocialRequest {
  url: string;
  method: "POST" | "GET";
  headers: Record<string, string>;
  body: string;
}
export type SocialTransport = (r: SocialRequest) => Promise<{ status: number; json: Record<string, unknown> | null }>;

let transport: SocialTransport = async (r) => {
  const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.method === "GET" ? undefined : r.body });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};

// Tests hand in a fake transport here.
export function setSocialTransport(fn: SocialTransport | null) {
  transport = fn ?? transport;
}

export interface SocialResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function postToX(db: Db, text: string): Promise<SocialResult> {
  const c = parseXCredentials(await clipboardValue(db, "x_credentials"));
  if (!c) return { ok: false, error: "X keys not on the clipboard" };
  try {
    const res = await transport({ url: X_TWEETS, method: "POST", headers: { authorization: oauth1Header("POST", X_TWEETS, c), "content-type": "application/json" }, body: JSON.stringify({ text }) });
    const data = (res.json?.data ?? null) as { id?: string } | null;
    if (res.status >= 200 && res.status < 300 && data?.id) return { ok: true, id: data.id };
    return { ok: false, error: `X ${res.status}: ${String(res.json?.detail ?? res.json?.title ?? "post failed").slice(0, 160)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function postToFacebook(db: Db, message: string, link: string | null): Promise<SocialResult> {
  const page = parseFacebookPage(await clipboardValue(db, "facebook_page"));
  if (!page) return { ok: false, error: "Facebook Page id and token not on the clipboard" };
  const form = new URLSearchParams({ message, access_token: page.token });
  if (link) form.set("link", link);
  try {
    const res = await transport({ url: `https://graph.facebook.com/${GRAPH_VERSION}/${page.pageId}/feed`, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const id = res.json?.id;
    if (res.status >= 200 && res.status < 300 && typeof id === "string") return { ok: true, id };
    const e = (res.json?.error ?? null) as { message?: string } | null;
    return { ok: false, error: `Facebook ${res.status}: ${String(e?.message ?? "post failed").slice(0, 160)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The DocLedger Facebook Page (D074): the Social worker's own page, on its own clipboard item. Posts with a photo
// go to /photos with the picture's public address; text posts go to /feed with the link card.
export const DOCLEDGER_PAGE_KEY = "docledger_facebook_page";

export async function docledgerPage(db: Db): Promise<{ pageId: string; token: string } | null> {
  return parseFacebookPage(await clipboardValue(db, DOCLEDGER_PAGE_KEY));
}

function graphError(prefix: string, res: { status: number; json: Record<string, unknown> | null }): string {
  const e = (res.json?.error ?? null) as { message?: string } | null;
  return `${prefix} ${res.status}: ${String(e?.message ?? "request failed").slice(0, 160)}`;
}

export async function postToDocledgerPage(db: Db, post: { message: string; link?: string | null; imageUrl?: string | null }): Promise<SocialResult> {
  const page = await docledgerPage(db);
  if (!page) return { ok: false, error: "DocLedger Facebook Page not on the clipboard yet" };
  const photo = !!post.imageUrl;
  const form = new URLSearchParams({ access_token: page.token });
  if (photo) {
    form.set("url", post.imageUrl!);
    form.set("caption", post.link ? `${post.message}\n\n${post.link}` : post.message);
  } else {
    form.set("message", post.message);
    if (post.link) form.set("link", post.link);
  }
  try {
    const res = await transport({ url: `https://graph.facebook.com/${GRAPH_VERSION}/${page.pageId}/${photo ? "photos" : "feed"}`, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    // /photos answers with the photo id and the post id; the post id is what stats and comments hang off.
    const id = typeof res.json?.post_id === "string" ? res.json.post_id : res.json?.id;
    if (res.status >= 200 && res.status < 300 && typeof id === "string") return { ok: true, id };
    return { ok: false, error: graphError("Facebook", res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function replyOnDocledgerPage(db: Db, commentId: string, message: string): Promise<SocialResult> {
  const page = await docledgerPage(db);
  if (!page) return { ok: false, error: "DocLedger Facebook Page not on the clipboard yet" };
  const form = new URLSearchParams({ access_token: page.token, message });
  try {
    const res = await transport({ url: `https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/comments`, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const id = res.json?.id;
    if (res.status >= 200 && res.status < 300 && typeof id === "string") return { ok: true, id };
    return { ok: false, error: graphError("Facebook", res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// A read from the Graph API with the Page token. Null when the Page is not connected or the call fails.
export async function readDocledgerPage(db: Db, path: string, params: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
  const page = await docledgerPage(db);
  if (!page) return null;
  const q = new URLSearchParams({ ...params, access_token: page.token });
  const target = path.replace("{page}", page.pageId);
  try {
    const res = await transport({ url: `https://graph.facebook.com/${GRAPH_VERSION}/${target}?${q.toString()}`, method: "GET", headers: {}, body: "" });
    return res.status >= 200 && res.status < 300 ? res.json : null;
  } catch {
    return null;
  }
}
