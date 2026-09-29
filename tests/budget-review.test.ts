import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { approvals, budgetLedger, budgetReviews, revenue } from "@/db/schema";
import { reviewBudget } from "@/lib/budget";
import { getSettings, setSetting } from "@/lib/settings";
import { setTelegramApi } from "@/lib/telegram";
import { fakeTelegram, testSecretsKey } from "./helpers/fakes";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const LAUNCH = new Date("2026-10-01T04:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  process.env.SECRETS_KEY = testSecretsKey();
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  setTelegramApi(fakeTelegram().api);
  await setSetting(db, "simulation_mode", false);
  await setSetting(db, "launch_date", LAUNCH.toISOString());
}, 60_000);

afterAll(async () => {
  if (close) await close();
});

async function money(spend: number, rev: number, at: Date) {
  if (spend > 0) await db.insert(budgetLedger).values({ kind: "api_cost", amountUsd: spend.toFixed(6), simulated: false, occurredAt: at, createdAt: at });
  if (rev > 0) await db.insert(revenue).values({ source: "invoice", amountUsd: rev.toFixed(2), verified: true, verifiedAt: at, verifiedBy: "owner", simulated: false, occurredAt: at, createdAt: at });
}

describe("budget level review", () => {
  it("waits for the first full week", async () => {
    const r = await reviewBudget(db, new Date(LAUNCH.getTime() + 3 * DAY));
    expect(r.status).toBe("skipped");
  });

  it("raises the level when revenue is at least 2x spend", async () => {
    await money(5, 12, new Date(LAUNCH.getTime() + 2 * DAY));
    const r = await reviewBudget(db, new Date(LAUNCH.getTime() + 7 * DAY + 60_000));
    expect(r.status).toBe("raised");
    expect(r.levelAfter).toBe(2);
    expect(r.capAfter).toBeCloseTo(2.13, 2);
    const s = await getSettings(db);
    expect(s.budget_level).toBe(2);
    // the same week is not reviewed twice
    expect((await reviewBudget(db, new Date(LAUNCH.getTime() + 7 * DAY + 120_000))).status).toBe("skipped");
  });

  it("holds after one low week and drops after two", async () => {
    await money(6, 1, new Date(LAUNCH.getTime() + 9 * DAY));
    const hold = await reviewBudget(db, new Date(LAUNCH.getTime() + 14 * DAY + 60_000));
    expect(hold.status).toBe("held");
    await money(6, 0, new Date(LAUNCH.getTime() + 16 * DAY));
    const drop = await reviewBudget(db, new Date(LAUNCH.getTime() + 21 * DAY + 60_000));
    expect(drop.status).toBe("dropped");
    expect(drop.levelAfter).toBe(1);
    expect(drop.capAfter).toBe(1.7);
    const rows = await db.select().from(budgetReviews);
    expect(rows).toHaveLength(3);
  });

  it("raises an approval item when the next cap would pass the ceiling", async () => {
    await setSetting(db, "daily_cap_usd", 4.5);
    await money(10, 40, new Date(LAUNCH.getTime() + 23 * DAY));
    const r = await reviewBudget(db, new Date(LAUNCH.getTime() + 28 * DAY + 60_000));
    expect(r.status).toBe("needs_approval");
    const items = await db.select().from(approvals);
    expect(items.some((a) => a.type === "spend_increase" && a.status === "pending")).toBe(true);
    const s = await getSettings(db);
    expect(s.daily_cap_usd).toBe(4.5);
  });
});
