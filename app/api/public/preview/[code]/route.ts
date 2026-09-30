import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { publicPreview } from "@/lib/public-preview";

export const dynamic = "force-dynamic";

// The demo at demo.docledger.site asks for this when a visitor arrives from an email (?for=<code>), so the demo
// company is named after them and holds one of their kinds of document (D070).
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const p = await publicPreview(getDb(), code);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(p, { headers: { "Cache-Control": "no-store" } });
}
