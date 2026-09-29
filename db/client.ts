import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Node 22 ships a global WebSocket, which the Neon driver uses for the Pool.
// Keep one pool per runtime instance. Vercel Fluid compute reuses it across requests.

let pool: Pool | null = null;
let db: NeonDatabase<typeof schema> | null = null;

export function getDb(): NeonDatabase<typeof schema> {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  neonConfig.poolQueryViaFetch = true;
  pool = new Pool({ connectionString: url, max: 3 });
  db = drizzle(pool, { schema });
  return db;
}

export type Db = NeonDatabase<typeof schema>;
export { schema };
