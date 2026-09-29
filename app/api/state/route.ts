import { getDb } from "@/db/client";
import { json } from "@/lib/http";
import { getTowerState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getTowerState(getDb());
  return json({ ok: true, state });
}
