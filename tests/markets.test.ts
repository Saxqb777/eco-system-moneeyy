import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { playbookFor } from "@/agents/playbooks";
import type { Db } from "@/db/client";
import { floors, leads, setupItems, tasks } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { REGIONS, inBusinessHours, normaliseCountry, regionFor, skippedCountries } from "@/lib/markets";
import { setSetting } from "@/lib/settings";
import { testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
}, 60_000);

afterAll(async () => {
  if (close) await close();
});

describe("DocLedger worldwide", () => {
  it("sends only in the reader's working hours and never on their weekend", () => {
    const tueNoonUtc = new Date("2026-10-06T12:00:00Z");
    expect(inBusinessHours("GB", tueNoonUtc)).toBe(true); // 12:00 London
    expect(inBusinessHours("AE", tueNoonUtc)).toBe(false); // 16:00 Dubai is closing time
    expect(inBusinessHours("AE", new Date("2026-10-06T08:00:00Z"))).toBe(true); // 12:00 Dubai
    expect(inBusinessHours("AU", tueNoonUtc)).toBe(false); // 22:00 Sydney
    expect(inBusinessHours("US", new Date("2026-10-06T15:00:00Z"))).toBe(true); // 10:00 New York
    expect(inBusinessHours("SA", new Date("2026-10-09T09:00:00Z"))).toBe(false); // Friday in Riyadh
    expect(inBusinessHours("GB", new Date("2026-10-09T09:00:00Z"))).toBe(true); // Friday in London
    expect(inBusinessHours("GB", new Date("2026-10-10T11:00:00Z"))).toBe(false); // Saturday
  });

  it("reads country codes the way people write them", () => {
    expect(normaliseCountry("uk")).toBe("GB");
    expect(normaliseCountry("UAE")).toBe("AE");
    expect(normaliseCountry(" sg ")).toBe("SG");
    expect(normaliseCountry("Singapore")).toBe("");
  });

  it("turns through the regions a day at a time", () => {
    const seen = new Set(Array.from({ length: REGIONS.length }, (_, i) => regionFor(new Date(Date.UTC(2026, 9, 1 + i, 6)))));
    expect(seen.size).toBe(REGIONS.length);
  });

  it("skips consent first countries, and the US until a postal address is on the clipboard", async () => {
    expect(Object.keys(await skippedCountries(db)).sort()).toEqual(["CA", "DE", "US"]);
    await db.update(setupItems).set({ status: "present", valueEncrypted: encryptSecret("Office 12, Business Bay, Dubai, UAE"), hint: "set" }).where(eq(setupItems.key, "business_address"));
    expect(Object.keys(await skippedCountries(db)).sort()).toEqual(["CA", "DE"]);
    await setSetting(db, "docledger_skip_countries", ["CA"]);
    expect(Object.keys(await skippedCountries(db))).toEqual(["CA"]);
    await setSetting(db, "docledger_skip_countries", ["CA", "DE"]);
  });

  it("keeps worldwide leads with their country and drops the ones we must not write to", async () => {
    const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
    const [task] = await db.insert(tasks).values({ floorId: floor!.id, kind: "find_leads", title: "Find leads", status: "running", simulated: false }).returning();
    const scout = playbookFor("find_leads")!;
    const now = new Date("2026-10-06T06:00:00Z");
    const res = await scout.absorb(task!, {
      leads: [
        { company: "Thames Freight Ltd", website: "https://thamesfreight.example", segment: "freight_forwarder", city: "London", country: "UK", sourceUrl: "https://bifa.example", phone: "", why: "Customs heavy" },
        { company: "Harbour Link Pty", website: "https://harbourlink.example", segment: "small_3pl", city: "Sydney", country: "AU", sourceUrl: "https://x.example", phone: "", why: "3PL" },
        { company: "Maple Cargo Inc", website: "https://maplecargo.example", segment: "freight_forwarder", city: "Toronto", country: "CA", sourceUrl: "https://x.example", phone: "", why: "Forwarder" },
        { company: "Nowhere Co", website: "", segment: "trading_company", city: "", country: "", sourceUrl: "https://x.example", phone: "", why: "?" },
      ],
      note: "",
    }, { db, now, floorId: floor!.id, agentId: null, agentName: "Scout" });
    expect(res.summary).toBe("Found 2 new leads, 2 in a country we skip");
    const rows = await db.select({ company: leads.company, country: leads.country }).from(leads);
    expect(rows.sort((a, b) => a.company.localeCompare(b.company))).toEqual([
      { company: "Harbour Link Pty", country: "AU" },
      { company: "Thames Freight Ltd", country: "GB" },
    ]);
  });
});
