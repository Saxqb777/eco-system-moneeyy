import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { setupItems } from "@/db/schema";
import { bad, json, readJson } from "@/lib/http";
import { asNumber, getSettings, setSetting } from "@/lib/settings";
import { clearSimulationData } from "@/sim/generator";

export const dynamic = "force-dynamic";

const EDITABLE = new Set(["simulation_mode", "sound_enabled", "daily_cap_usd", "hard_ceiling_usd", "warden_interval_hours", "brief_hour_local", "model_overrides"]);

export async function GET() {
  const s = await getSettings(getDb());
  return json({ ok: true, settings: s });
}

// Body: { key, value } or { action: "clear_simulation" }
export async function POST(req: Request) {
  const db = getDb();
  const body = await readJson<{ key?: string; value?: unknown; action?: string }>(req);
  if (!body) return bad("Invalid JSON");

  if (body.action === "clear_simulation") {
    await clearSimulationData(db);
    return json({ ok: true, cleared: true });
  }

  const { key, value } = body;
  if (!key || !EDITABLE.has(key)) return bad("That setting cannot be changed here");

  if (key === "simulation_mode" && value === false) {
    const [k] = await db.select().from(setupItems).where(eq(setupItems.key, "anthropic_api_key")).limit(1);
    if (!k || k.status !== "present") return bad("Paste the Anthropic API key first. Simulation stays on until then.");
  }
  if (key === "daily_cap_usd") {
    const s = await getSettings(db);
    const ceiling = asNumber(s.hard_ceiling_usd, 5);
    const v = asNumber(value, NaN);
    if (!Number.isFinite(v) || v <= 0) return bad("Cap must be a positive number");
    if (v > ceiling) return bad(`Cap cannot pass the hard ceiling of ${ceiling} USD. Raising the ceiling is an approval item.`);
  }
  await setSetting(db, key, value);
  return json({ ok: true, key, value });
}
