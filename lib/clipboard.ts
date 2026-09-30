// Reads one pasted value off Warden's clipboard (setup_items), decrypted. Never returned to a browser.
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { floors, setupItems } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

export async function clipboardValue(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select().from(setupItems).where(eq(setupItems.key, key)).limit(1);
  if (!row || row.status !== "present" || !row.valueEncrypted) return null;
  try {
    return decryptSecret(row.valueEncrypted);
  } catch {
    return null;
  }
}

// Clipboard items that serve one floor only. While that floor is archived (a closed business) they leave the
// Setup tab, the game and Warden's snapshot, so nobody is asked for a Deals channel that no longer exists.
// The saved values stay; bringing the floor back brings them back.
export const FLOOR_ONLY_SETUP: Record<string, string[]> = {
  deals: ["affiliate_amazon_ae", "affiliate_noon", "affiliate_other", "deals_channel", "x_credentials", "facebook_page"],
};

export async function hiddenSetupKeys(db: Db): Promise<Set<string>> {
  const archived = await db.select({ slug: floors.slug }).from(floors).where(eq(floors.status, "archived"));
  return new Set(archived.flatMap((f) => FLOOR_ONLY_SETUP[f.slug] ?? []));
}

/** The clipboard as the owner and Warden see it: every item, minus those of archived floors, in order. */
export async function visibleSetupRows(db: Db) {
  const [rows, hidden] = await Promise.all([db.select().from(setupItems).orderBy(asc(setupItems.sort)), hiddenSetupKeys(db)]);
  return rows.filter((r) => !hidden.has(r.key));
}
