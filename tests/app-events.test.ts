import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { floors, leads, messagesOut, revenue, taskEvents } from "@/db/schema";
import { recordAppEvent } from "@/lib/app-events";
import { appUsageByCode, setUsageFetch, usageLine } from "@/lib/app-usage";
import { setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const T0 = new Date("2026-10-06T06:00:00Z");

async function addLead(company: string, code: string, status = "contacted") {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [lead] = await db.insert(leads).values({ floorId: floor!.id, company, dedupeKey: company.toLowerCase().replace(/\s+/g, "-"), website: `https://${code}.example`, segment: "freight_forwarder", city: "Dubai", country: "AE", score: 8, status, decisionMaker: { name: "", title: "", email: `info@${code}.example` }, previewCode: code, simulated: false }).returning();
  return lead!;
}

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  process.env.DEMO_EVENT_KEY = "test-key";
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  await setSetting(db, "simulation_mode", false);
  await setSetting(db, "docledger_site_url", "https://docledger.example");
}, 60_000);

afterAll(async () => {
  setUsageFetch(null);
  delete process.env.DEMO_EVENT_KEY;
  if (close) await close();
});

describe("The app tells the Tower what happened (D080)", () => {
  it("starts the free month on signup, makes a customer on payment, closes on cancel", async () => {
    const lead = await addLead("Signup Freight", "signupfr");
    expect(await recordAppEvent(db, "nocode01", { kind: "signup" }, T0)).toEqual({ ok: false, note: "no lead for that code" });
    const r1 = await recordAppEvent(db, "signupfr", { kind: "signup", orgId: "42", company: "Signup Freight LLC", email: "farah@signupfr.example", name: "Farah Haddad" }, T0);
    expect(r1).toMatchObject({ ok: true, status: "trial" });
    let [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("trial");
    const dm = l!.decisionMaker as Record<string, unknown>;
    expect(dm.appOrgId).toBe("42");
    expect(dm.name).toBe("Farah Haddad");
    expect(dm.trialStart).toBe(T0.toISOString());
    expect(dm.successSteps).toEqual([]);
    expect((await db.select().from(messagesOut).where(eq(messagesOut.kind, "trial"))).length).toBe(1);

    const r2 = await recordAppEvent(db, "signupfr", { kind: "past_due", orgId: "42" }, T0);
    expect(r2.status).toBe("trial");
    expect((await db.select().from(messagesOut).where(eq(messagesOut.kind, "billing"))).length).toBe(1);

    const r3 = await recordAppEvent(db, "signupfr", { kind: "paid", orgId: "42", monthlyUsd: 99 }, new Date(T0.getTime() + 25 * 86400_000));
    expect(r3).toMatchObject({ ok: true, status: "client" });
    [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("client");
    expect((l!.decisionMaker as { monthlyUsd: number }).monthlyUsd).toBe(99);
    const rev = await db.select().from(revenue).where(eq(revenue.leadId, lead.id));
    expect(rev).toHaveLength(1);
    expect(rev[0]!.verifiedBy).toBe("paddle");
    expect(Number(rev[0]!.amountUsd)).toBe(99);
    // a second paid event (the monthly renewal) adds no second first month row
    await recordAppEvent(db, "signupfr", { kind: "paid", orgId: "42", monthlyUsd: 99 }, new Date(T0.getTime() + 55 * 86400_000));
    expect(await db.select().from(revenue).where(eq(revenue.leadId, lead.id))).toHaveLength(1);
    expect((await db.select().from(messagesOut).where(eq(messagesOut.kind, "won"))).length).toBe(1);

    const r4 = await recordAppEvent(db, "signupfr", { kind: "cancelled", orgId: "42" }, new Date(T0.getTime() + 80 * 86400_000));
    expect(r4.status).toBe("lost");
    [l] = await db.select().from(leads).where(eq(leads.id, lead.id));
    expect(l!.status).toBe("lost");
    const events = await db.select().from(taskEvents).where(eq(taskEvents.type, "milestone"));
    expect(events.some((e) => e.message.includes("started the free month in the app"))).toBe(true);
    expect(events.some((e) => e.message.includes("added a card at 99.00 USD"))).toBe(true);
  });

  it("reads usage from the app with the shared key and writes it in plain words", async () => {
    const asked: Array<{ url: string; key: string }> = [];
    setUsageFetch(async (url, key) => {
      asked.push({ url, key });
      return { ok: true, json: { orgs: [{ orgId: "42", company: "Signup Freight LLC", plan: "trial", trialEndsAt: "2026-11-05T06:00:00.000Z", code: "signupfr", since: T0.toISOString(), readsTotal: 12, reads7d: 5, lastReadAt: new Date(T0.getTime() - 6 * 3600_000).toISOString(), members: 2, ownTypes: 1 }] } };
    });
    const usage = await appUsageByCode(db, ["signupfr", "bad code!", "signupfr"]);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe("https://docledger.example/api/tower/usage?codes=signupfr");
    expect(asked[0]!.key).toBe("test-key");
    expect(usage.get("signupfr")?.reads7d).toBe(5);
    expect(usageLine(usage.get("signupfr"), T0)).toBe("12 documents read in all, 5 in the last 7 days, 2 members, 1 own document type, last read 6 hours ago. Plan: trial, free month ends 2026-11-05.");
    expect(usageLine(undefined)).toBe("No usage numbers from the app yet.");
    // the app asleep or refusing: no numbers, no error
    setUsageFetch(async () => {
      throw new Error("timeout");
    });
    expect((await appUsageByCode(db, ["signupfr"])).size).toBe(0);
    expect((await appUsageByCode(db, [])).size).toBe(0);
  });
});
