import { cookies } from "next/headers";
import { OWNER_COOKIE, verifySessionToken } from "@/lib/auth";
import { verifyGithubOidc } from "@/lib/github-oidc";
import { bearerOk, json, unauthorized } from "@/lib/http";
import { HEARTBEAT_GAP_MS } from "@/warden/heartbeat";
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

// Three doors, all checked server side: the cron bearer secret, a GitHub Actions OIDC token
// minted inside this repository, or the owner's session cookie from the game.
async function callerOk(req: Request): Promise<{ ok: boolean; via: string; reason?: string }> {
  if (bearerOk(req)) return { ok: true, via: "cron_secret" };
  if (req.headers.get("x-tower-auth") === "github-oidc") {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const check = await verifyGithubOidc(token);
    return check.ok ? { ok: true, via: `github:${check.event}` } : { ok: false, via: "github", reason: check.reason };
  }
  if (await ownerOk()) return { ok: true, via: "owner" };
  return { ok: false, via: "none" };
}

async function handle(req: Request) {
  const caller = await callerOk(req);
  if (!caller.ok) return unauthorized(caller.reason ? `Not allowed: ${caller.reason}` : "Bad or missing credentials");
  const url = new URL(req.url);
  const raw = url.searchParams.get("trigger") ?? "cron";
  const trigger = (TRIGGERS.includes(raw as TickTrigger) ? raw : "cron") as TickTrigger;
  try {
    // Scheduled knocks share the heartbeat's gap, so GitHub and Neon landing together run one tick.
    const result = await runTick(trigger, new Date(), trigger === "cron" ? { via: caller.via, minGapMs: HEARTBEAT_GAP_MS } : { via: caller.via });
    return json({ ok: true, via: caller.via, ...result });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
