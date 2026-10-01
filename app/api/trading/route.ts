import { getDb } from "@/db/client";
import { json } from "@/lib/http";
import { mockEnabled, mockTradingDetail } from "@/lib/mock-state";
import { tradingDetail } from "@/trading/view";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// The Trading tab: Wall Street's leaderboard, curves, open trades, meetings and lessons. Owner only (middleware).
export async function GET() {
  if (mockEnabled()) return json({ ok: true, trading: mockTradingDetail() });
  return json({ ok: true, trading: await tradingDetail(getDb()) });
}

// The owner's Run the floor now: one pulse right away, outside the 4 minute gap. Paper money only.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "pulse") return json({ ok: false, error: "Unknown action" }, { status: 400 });
  if (mockEnabled()) return json({ ok: true, status: "ran" });
  const { runTradingPulse } = await import("@/trading/pulse");
  const res = await runTradingPulse(getDb(), new Date(), { force: true });
  return json({ ok: true, status: res.status, errors: res.steps.errors ?? [] });
}
