import { after } from "next/server";
import { getDb } from "@/db/client";
import { json } from "@/lib/http";
import { heartbeatDue, heartbeatSource, lastScheduledTickAt } from "@/warden/heartbeat";
import { heartbeatIfDue } from "@/warden/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The public heartbeat. Any clock may knock (Neon's scheduler every 5 minutes, GitHub, Vercel's daily cron),
// no secret needed: a tick runs only when the last scheduled one is 13 minutes old, one at a time, so a
// stranger knocking can at most make the Tower run on its normal schedule. Every side effect still needs an
// approved item and the daily cap still holds. The answer says only whether a tick started.
// Wall Street's pulse (D075) rides every knock: it keeps its own 4 minute gap and lock, and moves paper money only.
async function handle(req: Request) {
  // Vercel's own cron calls the plain path and says who it is in the user agent.
  const via = /vercel-cron/i.test(req.headers.get("user-agent") ?? "") ? "vercel" : heartbeatSource(new URL(req.url).searchParams.get("via"));
  const now = new Date();
  const last = await lastScheduledTickAt(getDb());
  if (!heartbeatDue(last, now)) {
    after(async () => {
      try {
        const { runTradingPulse } = await import("@/trading/pulse");
        await runTradingPulse(getDb());
      } catch (err) {
        console.error("trading pulse failed", err instanceof Error ? err.message : err);
      }
    });
    return json({ ok: true, status: "fresh", lastTickAt: last?.toISOString() ?? null });
  }
  after(async () => {
    try {
      await heartbeatIfDue(via);
    } catch (err) {
      console.error("heartbeat tick failed", err instanceof Error ? err.message : err);
    }
  });
  return json({ ok: true, status: "started", lastTickAt: last?.toISOString() ?? null }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
