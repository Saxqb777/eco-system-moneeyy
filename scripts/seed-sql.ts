// Prints idempotent seed SQL built from config/tower.ts. Used when the database
// can only be reached through the Neon console or the Neon connection, not from here.
import { AGENTS, DEFAULT_SETTINGS, FLOORS, SETUP_ITEMS } from "@/config/tower";

const q = (v: unknown) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const arr = (v: string[]) => `ARRAY[${v.map(q).join(",")}]::text[]`;

const out: string[] = [];
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  out.push(`INSERT INTO settings (key, value) VALUES (${q(key)}, ${j(value)}) ON CONFLICT (key) DO NOTHING`);
}
for (const f of FLOORS) {
  out.push(
    `INSERT INTO floors (slug, name, level, accent, goal_metric, weekly_target, target_unit, status, unlock_rule, unlock_condition, niche, next_niches, monthly_guide_usd, is_business, sort) VALUES (${q(f.slug)}, ${q(f.name)}, ${f.level}, ${q(f.accent)}, ${q(f.goalMetric)}, ${f.weeklyTarget}, ${q(f.targetUnit)}, ${q(f.status)}, ${q(f.unlockRule)}, ${f.unlockCondition ? j(f.unlockCondition) : "NULL"}, ${q(f.niche)}, ${j(f.nextNiches)}, ${f.monthlyGuideUsd}, ${f.isBusiness}, ${5 - f.level}) ON CONFLICT (slug) DO NOTHING`,
  );
}
for (const a of AGENTS) {
  const level = FLOORS.find((f) => f.slug === a.floorSlug)?.level ?? 0;
  out.push(
    `INSERT INTO agents (slug, floor_id, name, role, kind, model_key, playbook_key, sprite, location_level, status) VALUES (${q(a.slug)}, (SELECT id FROM floors WHERE slug = ${q(a.floorSlug)}), ${q(a.name)}, ${q(a.role)}, ${q(a.kind)}, ${q(a.modelKey)}, ${q(a.playbookKey)}, ${j(a.sprite)}, ${level}, 'idle') ON CONFLICT (slug) DO NOTHING`,
  );
}
for (const s of SETUP_ITEMS) {
  out.push(
    `INSERT INTO setup_items (key, label, how_to, kind, required_for, sort) VALUES (${q(s.key)}, ${q(s.label)}, ${q(s.howTo)}, ${q(s.kind)}, ${arr(s.requiredFor)}, ${s.sort}) ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, how_to = EXCLUDED.how_to, kind = EXCLUDED.kind, required_for = EXCLUDED.required_for, sort = EXCLUDED.sort`,
  );
}
process.stdout.write(JSON.stringify(out));
