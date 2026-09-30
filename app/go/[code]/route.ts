import { NextResponse } from "next/server";
import { recordClick } from "@/agents/deals";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";

// Tracked link from a channel post: count the click, then send the reader to the store.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[a-z0-9]{4,12}$/.test(code)) return NextResponse.redirect(new URL("/deals", req.url), 302);
  const target = await recordClick(getDb(), code, { referrer: req.headers.get("referer"), userAgent: req.headers.get("user-agent"), country: req.headers.get("x-vercel-ip-country") }).catch(() => null);
  return NextResponse.redirect(target ?? new URL("/deals", req.url).toString(), 302);
}
