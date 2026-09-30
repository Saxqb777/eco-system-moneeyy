import { getDb } from "@/db/client";
import { builderSecrets, finishBuilderTicket, nextBuilderJob, startBuilderTicket, type BuilderResult } from "@/lib/builder";
import { verifyGithubOidc } from "@/lib/github-oidc";
import { bad, bearerOk, json, readJson, unauthorized } from "@/lib/http";

export const dynamic = "force-dynamic";

// Only the nightly job talks to this: a GitHub OIDC token from this repository, or the cron secret.
async function callerOk(req: Request): Promise<boolean> {
  if (bearerOk(req)) return true;
  if (req.headers.get("x-tower-auth") === "github-oidc") {
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    return (await verifyGithubOidc(token)).ok;
  }
  return false;
}

// GET ?action=next: the ticket to work on plus the secrets the job needs, once.
export async function GET(req: Request) {
  if (!(await callerOk(req))) return unauthorized();
  const db = getDb();
  const { job, reason } = await nextBuilderJob(db);
  if (!job) return json({ ok: true, job: null, reason });
  const secrets = await builderSecrets(db);
  return json({ ok: true, job, secrets });
}

// POST { action: "start", ticketId } or { action: "result", ...BuilderResult }
export async function POST(req: Request) {
  if (!(await callerOk(req))) return unauthorized();
  const body = await readJson<{ action?: string; ticketId?: string } & Partial<BuilderResult>>(req);
  if (!body?.action || !body.ticketId) return bad("action and ticketId are required");
  const db = getDb();
  if (body.action === "start") return json(await startBuilderTicket(db, body.ticketId));
  if (body.action === "result") {
    if (body.status !== "pr_open" && body.status !== "failed") return bad("status must be pr_open or failed");
    return json(await finishBuilderTicket(db, { ...body, ticketId: body.ticketId, status: body.status }));
  }
  return bad("unknown action");
}
