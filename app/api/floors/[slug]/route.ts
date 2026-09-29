import { getDb } from "@/db/client";
import { getFloorDetail, setFloorPaused } from "@/lib/detail";
import { bad, json, readJson } from "@/lib/http";
import { mockEnabled, mockFloorDetail } from "@/lib/mock-state";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

// The floor panel: goal, weekly numbers, active tasks, blockers, money, strategy note.
export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  if (mockEnabled()) {
    const floor = mockFloorDetail(slug);
    return floor ? json({ ok: true, floor }) : bad("Floor not found", 404);
  }
  const floor = await getFloorDetail(getDb(), slug);
  return floor ? json({ ok: true, floor }) : bad("Floor not found", 404);
}

// Body: { action: "pause" | "resume" }. Owner only, no approval needed: it is his building.
export async function POST(req: Request, { params }: Params) {
  const { slug } = await params;
  const body = await readJson<{ action?: string }>(req);
  if (body?.action !== "pause" && body?.action !== "resume") return bad("action must be pause or resume");
  if (mockEnabled()) return json({ ok: true, status: body.action === "pause" ? "paused" : "live" });
  const result = await setFloorPaused(getDb(), slug, body.action === "pause");
  if (!result.ok) return bad(result.error);
  return json({ ok: true, status: result.status });
}
