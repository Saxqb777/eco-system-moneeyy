import "dotenv/config";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { AGENTS, DEFAULT_SETTINGS, FLOORS, SETUP_ITEMS } from "@/config/tower";
import { getDb } from "@/db/client";
import { agents, floors, settings, setupItems } from "@/db/schema";

config({ path: ".env.local", override: false });

// Idempotent: inserts what is missing, never overwrites names Saaqib edited or values he pasted.
async function main() {
  const db = getDb();

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(settings).values({ key, value: value as object }).onConflictDoNothing();
  }

  for (const f of FLOORS) {
    await db
      .insert(floors)
      .values({
        slug: f.slug,
        name: f.name,
        level: f.level,
        accent: f.accent,
        goalMetric: f.goalMetric,
        weeklyTarget: String(f.weeklyTarget),
        targetUnit: f.targetUnit,
        status: f.status,
        unlockRule: f.unlockRule,
        unlockCondition: f.unlockCondition,
        niche: f.niche,
        nextNiches: f.nextNiches,
        monthlyGuideUsd: String(f.monthlyGuideUsd),
        isBusiness: f.isBusiness,
        sort: 5 - f.level,
      })
      .onConflictDoNothing();
  }

  const floorRows = await db.select().from(floors);
  const byslug = new Map(floorRows.map((f) => [f.slug, f.id]));
  for (const a of AGENTS) {
    const floorId = byslug.get(a.floorSlug);
    if (!floorId) throw new Error(`floor ${a.floorSlug} missing`);
    const level = FLOORS.find((f) => f.slug === a.floorSlug)?.level ?? 0;
    await db
      .insert(agents)
      .values({ slug: a.slug, floorId, name: a.name, role: a.role, kind: a.kind, modelKey: a.modelKey, playbookKey: a.playbookKey, sprite: a.sprite, locationLevel: level, status: "idle" })
      .onConflictDoNothing();
  }

  for (const s of SETUP_ITEMS) {
    await db
      .insert(setupItems)
      .values({ key: s.key, label: s.label, howTo: s.howTo, kind: s.kind, requiredFor: s.requiredFor, sort: s.sort })
      .onConflictDoUpdate({ target: setupItems.key, set: { label: s.label, howTo: s.howTo, kind: s.kind, requiredFor: s.requiredFor, sort: s.sort } });
  }

  const count = await db.select({ id: agents.id }).from(agents).where(eq(agents.kind, "warden"));
  console.log(`seeded: ${FLOORS.length} floors, ${AGENTS.length} agents, ${SETUP_ITEMS.length} setup items, warden rows ${count.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
