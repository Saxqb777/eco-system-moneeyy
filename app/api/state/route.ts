import { after } from "next/server";
import { getDb } from "@/db/client";
import { json } from "@/lib/http";
import { mockEnabled, mockState } from "@/lib/mock-state";
import { getTowerState } from "@/lib/state";
import { heartbeatIfDue } from "@/warden/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The open game is one more clock: when the owner watches and the last scheduled tick is 10 minutes old,
// a tick runs after the answer is sent. Checked at most once a minute per server instance.
let lastPokeCheck = 0;

export async function GET() {
  if (mockEnabled()) return json({ ok: true, state: mockState() });
  const state = await getTowerState(getDb());
  if (Date.now() - lastPokeCheck > 60_000) {
    lastPokeCheck = Date.now();
    after(async () => {
      try {
        await heartbeatIfDue("game");
      } catch (err) {
        console.error("game heartbeat failed", err instanceof Error ? err.message : err);
      }
    });
  }
  return json({ ok: true, state });
}
