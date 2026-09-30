import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { approvals, floors, leads, outreach } from "@/db/schema";
import { listThreads, mailboxCounts, threadDetail } from "@/lib/mailbox";
import { makeTestDb } from "./helpers/pglite";

let db: Db;
let close: () => Promise<void>;
const NOW = new Date("2026-10-06T08:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() - hours * 3600 * 1000);

async function lead(company: string, status: string, extra: Record<string, unknown> = {}) {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "docledger")).limit(1);
  const [l] = await db.insert(leads).values({ floorId: floor!.id, company, dedupeKey: company.toLowerCase(), status, country: "GB", city: "London", decisionMaker: { name: `${company} Boss`, title: "Finance Manager", email: `boss@${company.toLowerCase()}.example`, ...extra }, simulated: false, updatedAt: h(100) }).returning();
  return l!;
}

async function email(leadId: string, step: number, at: Date, how: "auto" | "telegram" | "pending" | null, opts: { reply?: string; replyAt?: Date; hot?: boolean; status?: string } = {}) {
  let approvalId: string | null = null;
  if (how) {
    const [a] = await db
      .insert(approvals)
      .values({ type: "outreach_email", status: how === "pending" ? "pending" : "approved", summary: `step ${step}`, content: { hot: opts.hot ?? false }, decidedVia: how === "pending" ? null : how, decidedAt: how === "pending" ? null : at, simulated: false, createdAt: at })
      .returning();
    approvalId = a!.id;
  }
  await db.insert(outreach).values({ leadId, step, subject: `Subject ${step}`, bodyText: `Body ${step}`, status: opts.status ?? (how === "pending" ? "draft" : "sent"), sentAt: how === "pending" ? null : at, replyText: opts.reply ?? null, replyAt: opts.replyAt ?? null, approvalId, simulated: false, createdAt: at });
}

beforeAll(async () => {
  const t = await makeTestDb();
  db = t.db;
  close = t.close;
  const hot = await lead("Thames", "replied");
  await email(hot.id, 1, h(50), "auto", { reply: "Can we see it next week? What does it cost?", replyAt: h(20), status: "answered" });
  await email(hot.id, 2, h(19), "pending", { hot: true });
  const waiting = await lead("Gulf", "drafted");
  await email(waiting.id, 1, h(2), "pending");
  const sent = await lead("Harbour", "contacted");
  await email(sent.id, 1, h(120), "telegram");
  await email(sent.id, 2, h(30), "auto");
  const paused = await lead("Desert", "replied", { snoozeUntil: new Date(NOW.getTime() + 20 * 24 * 3600 * 1000).toISOString() });
  await email(paused.id, 1, h(200), "auto", { reply: "Busy season, later.", replyAt: h(150), status: "answered" });
  await email(paused.id, 2, h(149), "auto");
  const closed = await lead("Marina", "lost");
  await email(closed.id, 1, h(300), "auto", { reply: "Remove me.", replyAt: h(280), status: "answered" });
}, 60_000);

afterAll(async () => {
  if (close) await close();
});

describe("The mail room", () => {
  it("lists one thread per company, most urgent first, with the right state", async () => {
    const threads = await listThreads(db, false, "all", NOW);
    expect(threads.map((t) => [t.company, t.state])).toEqual([
      ["Thames", "hot"],
      ["Gulf", "waiting"],
      ["Harbour", "sent"],
      ["Desert", "paused"],
      ["Marina", "closed"],
    ]);
    expect(mailboxCounts(threads)).toEqual({ hot: 1, waiting: 2 });
    expect((await listThreads(db, false, "hot", NOW)).map((t) => t.company)).toEqual(["Thames"]);
    expect((await listThreads(db, false, "waiting", NOW)).map((t) => t.company)).toEqual(["Thames", "Gulf"]);
    const marina = threads.find((t) => t.company === "Marina")!;
    expect(marina).toMatchObject({ lastFrom: "them", lastLine: "Remove me.", messages: 2 });
  });

  it("opens a thread with every email and reply in order, and how each one went out", async () => {
    const [thames] = await db.select().from(leads).where(eq(leads.company, "Thames")).limit(1);
    const t = (await threadDetail(db, thames!.id, NOW))!;
    expect(t.items.map((m) => [m.from, m.how])).toEqual([
      ["us", "auto"],
      ["them", null],
      ["us", "waiting"],
    ]);
    expect(t.items[1]!.body).toBe("Can we see it next week? What does it cost?");
    const [harbour] = await db.select().from(leads).where(eq(leads.company, "Harbour")).limit(1);
    expect((await threadDetail(db, harbour!.id, NOW))!.items.map((m) => m.how)).toEqual(["approved", "auto"]);
    expect(await threadDetail(db, "00000000-0000-0000-0000-000000000000", NOW)).toBeNull();
  });
});
