import { NextResponse } from "next/server";
import { createSessionToken, OWNER_COOKIE, passcodeMatches, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/");
  const secret = process.env.SECRETS_KEY;
  if (!secret || !passcodeMatches(passcode)) {
    const url = new URL("/login?error=1", req.url);
    return NextResponse.redirect(url, { status: 303 });
  }
  const token = await createSessionToken(secret);
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.url), { status: 303 });
  res.cookies.set(OWNER_COOKIE, token, sessionCookieOptions);
  return res;
}

export async function DELETE(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.set(OWNER_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
  return res;
}
