import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { recordAppEvent, type AppEventKind } from "@/lib/app-events";
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

const APP_EVENTS: AppEventKind[] = ["signup", "paid", "cancelled", "past_due"];

// The app reports what happened to that company: a document read inside its demo (D077), or its free month,
// card, cancellation or failed payment in the real app (D080). Signed with DEMO_EVENT_KEY (same value on both projects).
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!bearerOk(req, "DEMO_EVENT_KEY")) return unauthorized("DEMO_EVENT_KEY missing or wrong");
  const { code } = await params;
  if (!/^[a-z0-9]{4,12}$/.test(code)) return json({ ok: false, error: "bad code" }, { status: 400 });
  const body = await readJson<{ kind?: string; orgId?: string; company?: string; email?: string; name?: string; monthlyUsd?: number | null }>(req);
  const kind = body?.kind ?? "";
  if (kind === "read") {
    const r = await recordDemoRead(getDb(), code, new Date());
    return json({ ok: true, ...r });
  }
  if ((APP_EVENTS as string[]).includes(kind)) {
    const r = await recordAppEvent(getDb(), code, { kind: kind as AppEventKind, orgId: body?.orgId, company: body?.company, email: body?.email, name: body?.name, monthlyUsd: typeof body?.monthlyUsd === "number" ? body.monthlyUsd : null }, new Date());
    return json(r, { status: r.ok ? 200 : 404 });
  }
  return json({ ok: false, error: "unknown event" }, { status: 400 });
}
