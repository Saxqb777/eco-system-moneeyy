import { getDb } from "@/db/client";
import { companyView } from "@/lib/company";
import { json } from "@/lib/http";
import { mockCompany, mockEnabled } from "@/lib/mock-state";

export const dynamic = "force-dynamic";

// The Company tab: DocLedger as a startup. Owner only (middleware).
export async function GET() {
  if (mockEnabled()) return json({ ok: true, company: mockCompany() });
  return json({ ok: true, company: await companyView(getDb()) });
}

// The owner switches auto posting on the DocLedger Facebook Page off (or back on) from the Company tab.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; on?: unknown };
  if (body.action !== "auto_post" || typeof body.on !== "boolean") return json({ ok: false, error: "Unknown action" }, { status: 400 });
  if (mockEnabled()) return json({ ok: true, autoPost: body.on });
  const { setAutoPost } = await import("@/agents/social");
  await setAutoPost(getDb(), body.on);
  return json({ ok: true, autoPost: body.on });
}
