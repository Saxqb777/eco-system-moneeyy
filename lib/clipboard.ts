// Reads one pasted value off Warden's clipboard (setup_items), decrypted. Never returned to a browser.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { setupItems } from "@/db/schema";
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
