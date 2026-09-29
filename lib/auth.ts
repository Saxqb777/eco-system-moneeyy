// Owner session cookie, signed with HMAC SHA256 through Web Crypto so it works in
// the Next.js middleware (edge) and in route handlers (node) alike.

export const OWNER_COOKIE = "tower_owner";
const SESSION_DAYS = 30;

async function hmacHex(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `owner.${exp}`;
  const sig = await hmacHex(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "owner") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = await hmacHex(`${parts[0]}.${parts[1]}`, secret);
  return timingSafeEqual(expected, parts[2] ?? "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passcodeMatches(given: string): boolean {
  const expected = process.env.OWNER_PASSCODE ?? "";
  if (!expected) return false;
  return timingSafeEqual(given, expected);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};
