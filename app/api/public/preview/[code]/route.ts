import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { recordDemoRead, recordDemoVisit } from "@/lib/demo-visits";
import { bearerOk, json, readJson, unauthorized } from "@/lib/http";
import { publicPreview } from "@/lib/public-preview";

export const dynamic = "force-dynamic";

// The demo at demo.docledger.site asks for this when a visitor arrives from an email (?for=<code>), so the demo
// company is named after them and holds one of their kinds of document (D070). The call itself is the visit (D077):
// the app passes the visitor's browser in x-visitor-agent so link checkers can be told apart.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = getDb();
  const p = await publicPreview(db, code);
  if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    await recordDemoVisit(db, code, new Date(), { agent: req.headers.get("x-visitor-agent") });
  } catch (err) {
    console.error("[demo visit]", err instanceof Error ? err.message : err);
  }
  return NextResponse.json(p, { headers: { "Cache-Control": "no-store" } });
}

// The app reports a document read inside that company's demo. Signed with DEMO_EVENT_KEY (same value on both projects).
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!bearerOk(req, "DEMO_EVENT_KEY")) return unauthorized("DEMO_EVENT_KEY missing or wrong");
  const { code } = await params;
  const body = await readJson<{ kind?: string }>(req);
  if (body?.kind !== "read") return json({ ok: false, error: "unknown event" }, { status: 400 });
  const r = await recordDemoRead(getDb(), code, new Date());
  return json({ ok: true, ...r });
}
