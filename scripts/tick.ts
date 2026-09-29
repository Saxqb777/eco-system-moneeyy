import "dotenv/config";
import { config } from "dotenv";
import { runTick } from "@/warden/tick";

config({ path: ".env.local", override: false });

// Local heartbeat for development: pnpm tick
runTick("manual")
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
