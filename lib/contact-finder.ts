// D079: the code reads a company's website for its addresses before the Analyst spends a model call on it.
// Home page, then the contact, about and team pages (linked or guessed), mailto links, plain addresses and
// Cloudflare's protected ones. The Analyst gets the list and picks; it never has to invent an address.
export interface FoundEmail {
  email: string;
  page: string;
  // a named person's box or a shared one (info@, sales@ and so on)
  kind: "personal" | "generic";
}

export interface ContactFinding {
  website: string | null;
  emails: FoundEmail[];
  phones: string[];
  pagesRead: string[];
  // why nothing came back, in plain words, for the Analyst and the owner
  note: string | null;
}

export type PageFetch = (url: string) => Promise<{ ok: boolean; status: number; html: string } | null>;

const DEFAULT_TIMEOUT_MS = 8000;
let fetchPage: PageFetch = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; DocLedgerBot/1.0; +https://docledger.site)", accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return { ok: res.ok, status: res.status, html: "" };
    const html = (await res.text()).slice(0, 600_000);
    return { ok: res.ok, status: res.status, html };
  } catch {
    return null;
  }
};

export function setPageFetch(fn: PageFetch | null): void {
  fetchPage = fn ?? fetchPage;
}

export const GENERIC_BOXES = /^(info|hello|hi|hey|sales|admin|contact|contactus|enquiry|enquiries|inquiry|inquiries|office|mail|support|help|operations|ops|cs|customerservice|customer\.service|marketing|accounts|accounting|finance|csr|booking|bookings|export|import|imports|exports|logistics|freight|shipping|team|general|reception|frontdesk|careers|jobs|hr|press|media|legal|billing|invoices|quotes|quote|pricing)$/i;
const JUNK = /(no-?reply|donotreply|example\.|sentry|wixpress|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|@2x|@3x|googlegroups|w3\.org|schema\.org|yourdomain|domain\.com|email\.com|company\.com|test\.com|sample\.)/i;
const CONTACT_PATHS = ["/contact", "/contact-us", "/contactus", "/contact.html", "/contact-us.html", "/about", "/about-us", "/aboutus", "/team", "/our-team", "/management", "/en/contact", "/en/contact-us"];

export function emailKind(email: string): "personal" | "generic" {
  const local = email.split("@")[0] ?? "";
  return GENERIC_BOXES.test(local) ? "generic" : "personal";
}

// Cloudflare's email protection: a hex string whose first byte is the key.
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out) ? out : null;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const OBFUSCATED_RE = /([A-Za-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([A-Za-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*([A-Za-z]{2,})/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

export function emailsIn(html: string, page: string): FoundEmail[] {
  const out = new Map<string, FoundEmail>();
  const add = (raw: string) => {
    const email = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0] ?? "";
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) || JUNK.test(email)) return;
    if (!out.has(email)) out.set(email, { email, page, kind: emailKind(email) });
  };
  for (const m of html.matchAll(/mailto:([^"'\s>]+)/gi)) add(m[1] ?? "");
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    const d = decodeCfEmail(m[1] ?? "");
    if (d) add(d);
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/&#64;|&commat;/g, "@").replace(/<[^>]+>/g, " ");
  for (const m of text.matchAll(EMAIL_RE)) add(m[0]);
  for (const m of text.matchAll(OBFUSCATED_RE)) add(`${m[1]}@${m[2]}.${m[3]}`);
  return [...out.values()];
}

export function phonesIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="tel:([^"]+)"/gi)) out.add((m[1] ?? "").replace(/[^\d+]/g, ""));
  const text = html.replace(/<[^>]+>/g, " ");
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length >= 9 && digits.replace(/\D/g, "").length <= 15) out.add(digits);
  }
  return [...out].filter(Boolean).slice(0, 4);
}

function sameHost(base: URL, href: string): URL | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

// Links on the home page that smell like a contact, about or team page.
export function contactLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1] ?? "";
    const label = (m[2] ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
    if (!/contact|about|team|management|people|leadership|reach us|get in touch|our office/.test(`${href.toLowerCase()} ${label}`)) continue;
    const u = sameHost(base, href);
    if (u && !out.includes(u.toString())) out.push(u.toString());
  }
  return out.slice(0, 6);
}

function normaliseSite(site: string): URL | null {
  const s = site.trim();
  if (!s) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
}

// Reads up to maxPages pages of the site and returns what it found. Never throws.
export async function findContacts(site: string | null | undefined, opts: { maxPages?: number } = {}): Promise<ContactFinding> {
  const base = site ? normaliseSite(site) : null;
  if (!base) return { website: null, emails: [], phones: [], pagesRead: [], note: "no website to read" };
  const maxPages = opts.maxPages ?? 5;
  const emails = new Map<string, FoundEmail>();
  const phones = new Set<string>();
  const pagesRead: string[] = [];
  const queue: string[] = [base.toString()];
  const seen = new Set<string>();
  let blocked = 0;
  let failed = 0;
  const take = (found: FoundEmail[]) => {
    for (const f of found) if (!emails.has(f.email)) emails.set(f.email, f);
  };
  while (queue.length && pagesRead.length + failed < maxPages) {
    const url = queue.shift()!;
    const key = url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const page = await fetchPage(url);
    if (!page) {
      failed += 1;
      continue;
    }
    if (page.status === 403 || page.status === 429 || page.status === 503) blocked += 1;
    if (!page.ok || !page.html) {
      failed += 1;
      continue;
    }
    pagesRead.push(url);
    take(emailsIn(page.html, url));
    for (const p of phonesIn(page.html)) phones.add(p);
    if (pagesRead.length === 1) {
      for (const link of contactLinks(page.html, base)) queue.push(link);
      for (const path of CONTACT_PATHS) queue.push(new URL(path, base).toString());
    }
    // a named person's address ends the search early; shared boxes keep it going a little
    if ([...emails.values()].some((e) => e.kind === "personal")) break;
  }
  const list = [...emails.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "personal" ? -1 : 1));
  let note: string | null = null;
  if (!list.length) {
    if (!pagesRead.length) note = blocked ? "the site refused to be read (blocked)" : "the site could not be read";
    else note = `no address on ${pagesRead.length} page${pagesRead.length === 1 ? "" : "s"} read`;
  }
  return { website: base.toString().replace(/\/$/, ""), emails: list.slice(0, 12), phones: [...phones].slice(0, 4), pagesRead, note };
}

// One line for the Analyst's brief and the owner's eyes.
export function contactLine(f: ContactFinding): string {
  if (!f.emails.length) return `Addresses on their site: none (${f.note ?? "nothing found"}).${f.phones.length ? ` Phone on the site: ${f.phones[0]}.` : ""}`;
  const named = f.emails.filter((e) => e.kind === "personal").map((e) => e.email);
  const shared = f.emails.filter((e) => e.kind === "generic").map((e) => e.email);
  return `Addresses on their site (copied by the Tower, pick from these only): ${named.length ? `named ${named.join(", ")}` : "no named person"}${shared.length ? `; shared ${shared.join(", ")}` : ""}.${f.phones.length ? ` Phone on the site: ${f.phones[0]}.` : ""}`;
}
