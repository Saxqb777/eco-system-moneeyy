import { getDb } from "@/db/client";
import { json } from "@/lib/http";
import { runSimulation } from "@/sim/generator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called by the game every 20 seconds while it is open (simulation mode only).
export async function POST() {
  const summary = await runSimulation(getDb(), new Date(), { maxSlices: 36 });
  return json({ ok: true, summary });
}
