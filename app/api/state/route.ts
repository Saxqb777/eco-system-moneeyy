import { getDb } from "@/db/client";
import { json } from "@/lib/http";
import { mockEnabled, mockState } from "@/lib/mock-state";
import { getTowerState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  if (mockEnabled()) return json({ ok: true, state: mockState() });
  const state = await getTowerState(getDb());
  return json({ ok: true, state });
}
