import { getDb } from "@/db/client";
import { getWardenSummary } from "@/lib/detail";
import { json } from "@/lib/http";
import { mockEnabled, mockWardenSummary } from "@/lib/mock-state";

export const dynamic = "force-dynamic";

// The Warden panel tabs beyond the worker view: brief, budget, recent runs, what is missing.
export async function GET() {
  if (mockEnabled()) return json({ ok: true, warden: mockWardenSummary() });
  const warden = await getWardenSummary(getDb());
  return json({ ok: true, warden });
}
