import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE, verifySessionToken } from "@/lib/auth";
import { siteRoute } from "@/lib/site";

// Owner passcode gate. Public: the login page, health, the tick (bearer secret or OIDC), the heartbeat (gap limited),
// the Telegram webhook (secret header), the public deals pages, click links, the sitemap and robots.txt.
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/health$/, /^\/api\/tick$/, /^\/api\/heartbeat$/, /^\/api\/telegram$/, /^\/api\/email\/inbound$/, /^\/api\/builder$/, /^\/api\/deals(\/.*)?$/, /^\/deals(\/.*)?$/, /^\/go\/.+$/, /^\/for\/.+$/, /^\/docledger$/, /^\/sitemap\.xml$/, /^\/robots\.txt$/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // docledger.site shows the company page and the client previews only; the Tower keeps its own address (D067).
  const site = siteRoute(req.headers.get("host"), pathname);
  if (site.action === "rewrite") return NextResponse.rewrite(new URL(site.to, req.url));
  if (site.action === "redirect") return NextResponse.redirect(site.to, 308);
  if (site.action === "next") return NextResponse.next();
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();

  const secret = process.env.SECRETS_KEY;
  const token = req.cookies.get(OWNER_COOKIE)?.value;
  if (secret && (await verifySessionToken(token, secret))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Owner login required" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|design/).*)"],
};
