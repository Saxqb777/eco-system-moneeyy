import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// GitHub Actions can mint a short lived OIDC token for a workflow run. The Tower verifies it
// instead of sharing a secret: only workflows inside this repository can pass.

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const TOWER_OIDC_AUDIENCE = "the-tower";
export const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);

let remoteJwks: JWTVerifyGetKey | null = null;
function defaultJwks(): JWTVerifyGetKey {
  if (!remoteJwks) remoteJwks = createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`));
  return remoteJwks;
}

export interface OidcCheck {
  ok: boolean;
  reason?: string;
  repository?: string;
  event?: string;
  ref?: string;
}

export function allowedRepository(): string {
  return process.env.GITHUB_REPOSITORY_ALLOW ?? "Saxqb777/eco-system-moneeyy";
}

export async function verifyGithubOidc(token: string, keys: JWTVerifyGetKey = defaultJwks(), now = new Date()): Promise<OidcCheck> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: TOWER_OIDC_AUDIENCE,
      currentDate: now,
      clockTolerance: 60,
    });
    const repository = typeof payload.repository === "string" ? payload.repository : "";
    const event = typeof payload.event_name === "string" ? payload.event_name : "";
    const ref = typeof payload.ref === "string" ? payload.ref : "";
    if (repository.toLowerCase() !== allowedRepository().toLowerCase()) return { ok: false, reason: `repository ${repository} is not allowed`, repository, event, ref };
    if (!ALLOWED_EVENTS.has(event)) return { ok: false, reason: `event ${event} is not allowed`, repository, event, ref };
    return { ok: true, repository, event, ref };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
