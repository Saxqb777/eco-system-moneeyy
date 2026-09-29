import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth";

describe("owner session token", () => {
  it("round trips", async () => {
    const t = await createSessionToken("secret");
    expect(await verifySessionToken(t, "secret")).toBe(true);
    expect(await verifySessionToken(t, "other")).toBe(false);
    expect(await verifySessionToken(`${t}x`, "secret")).toBe(false);
  });
  it("expires", async () => {
    const t = await createSessionToken("secret", 0);
    expect(await verifySessionToken(t, "secret", 40 * 24 * 60 * 60 * 1000)).toBe(false);
  });
});
