import { cookies } from "next/headers";
import { OWNER_COOKIE, verifySessionToken } from "@/lib/auth";
import { bearerOk, json, unauthorized } from "@/lib/http";
import { runTick, type TickTrigger } from "@/warden/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TRIGGERS: TickTrigger[] = ["cron", "manual", "setup", "idea", "blocked", "ui"];

async function ownerOk(): Promise<boolean> {
  const secret = process.env.SECRETS_KEY;
  if (!secret) return false;
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  return verifySessionToken(token, secret);
}

// Called by the GitHub Actions cron with the bearer secret, or by the owner from the game.
async function handle(req: Request) {
  const allowed = bearerOk(req) || (await ownerOk());
  if (!allowed) return unauthorized("Bad or missing cron secret");
  const url = new URL(req.url);
  const raw = url.searchParams.get("trigger") ?? "cron";
  const trigger = (TRIGGERS.includes(raw as TickTrigger) ? raw : "cron") as TickTrigger;
  try {
    const result = await runTick(trigger);
    return json({ ok: true, ...result });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
