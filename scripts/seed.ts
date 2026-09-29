import "dotenv/config";
import { config } from "dotenv";
import { getDb } from "@/db/client";
import { seedTower } from "@/db/seed";

config({ path: ".env.local", override: false });

seedTower(getDb())
  .then((r) => {
    console.log(`seeded: ${r.floors} floors, ${r.agents} agents, ${r.setupItems} setup items`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
