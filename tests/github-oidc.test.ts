import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GITHUB_OIDC_ISSUER, TOWER_OIDC_AUDIENCE, verifyGithubOidc } from "@/lib/github-oidc";

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

async function mint(claims: Record<string, unknown>, opts: { issuer?: string; audience?: string; expired?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(opts.issuer ?? GITHUB_OIDC_ISSUER)
    .setAudience(opts.audience ?? TOWER_OIDC_AUDIENCE)
    .setIssuedAt(now - 10)
    .setExpirationTime(opts.expired ? now - 600 : now + 300)
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }] });
});

describe("GitHub OIDC verification", () => {
  it("accepts a scheduled run from this repository", async () => {
    const t = await mint({ repository: "Saxqb777/eco-system-moneeyy", event_name: "schedule", ref: "refs/heads/main" });
    const r = await verifyGithubOidc(t, keys);
    expect(r.ok).toBe(true);
    expect(r.event).toBe("schedule");
  });
  it("rejects another repository", async () => {
    const t = await mint({ repository: "someone/eco-system-moneeyy", event_name: "schedule" });
    expect((await verifyGithubOidc(t, keys)).ok).toBe(false);
  });
  it("rejects pull request events", async () => {
    const t = await mint({ repository: "Saxqb777/eco-system-moneeyy", event_name: "pull_request" });
    expect((await verifyGithubOidc(t, keys)).ok).toBe(false);
  });
  it("rejects a wrong audience, issuer or an expired token", async () => {
    expect((await verifyGithubOidc(await mint({ repository: "Saxqb777/eco-system-moneeyy", event_name: "schedule" }, { audience: "other" }), keys)).ok).toBe(false);
    expect((await verifyGithubOidc(await mint({ repository: "Saxqb777/eco-system-moneeyy", event_name: "schedule" }, { issuer: "https://evil.example" }), keys)).ok).toBe(false);
    expect((await verifyGithubOidc(await mint({ repository: "Saxqb777/eco-system-moneeyy", event_name: "schedule" }, { expired: true }), keys)).ok).toBe(false);
  });
  it("rejects garbage", async () => {
    expect((await verifyGithubOidc("not.a.token", keys)).ok).toBe(false);
  });
});
