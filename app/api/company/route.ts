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
