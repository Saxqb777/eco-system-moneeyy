// What the public demo may know about a lead (D070): its name, country and the sample document the Writer made
// for it, the same facts /for/<code> already shows. Nothing else about the lead leaves the Tower.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leads } from "@/db/schema";

export interface PublicPreview {
  company: string;
  country: string;
  sampleDocument: string | null;
  sampleFields: Array<{ field: string; value: string }>;
}

export async function publicPreview(db: Db, code: string): Promise<PublicPreview | null> {
  if (!/^[a-z0-9]{4,12}$/.test(code)) return null;
  const [lead] = await db.select().from(leads).where(eq(leads.previewCode, code)).limit(1);
  if (!lead || lead.simulated || !lead.preview) return null;
  const p = lead.preview as { sampleDocument?: string; sampleFields?: Array<{ field: string; value: string }> };
  return {
    company: lead.company,
    country: lead.country,
    sampleDocument: p.sampleDocument ?? null,
    sampleFields: Array.isArray(p.sampleFields) ? p.sampleFields.slice(0, 8).map((f) => ({ field: String(f.field), value: String(f.value) })) : [],
  };
}
