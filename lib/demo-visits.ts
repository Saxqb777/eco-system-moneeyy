// D077: who opened the demo company made for them. The demo app asks the Tower for a company's preview by code
// every time a visitor arrives from an email (?for=<code>), so that call is the visit. Link checkers in the
// reader's mail system open the link within minutes of the send: those count as scans, not visits.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { leads, outreach, taskEvents } from "@/db/schema";
import { enqueueMessage } from "@/lib/telegram";

export const SCAN_WINDOW_MS = 3 * 60_000;
const BURST_MS = 60_000;
const PING_GAP_MS = 6 * 3600_000;
const BOT_AGENT = /bot|crawl|spider|scan|preview|headless|phantom|curl|wget|python|java\/|okhttp|go-http|safelinks|proofpoint|mimecast|barracuda|defender|urlscan|fetch/i;

export type DemoVisit = { kind: "none" } | { kind: "scan" | "visit"; company: string; leadId: string; visits: number };

export async function recordDemoVisit(db: Db, code: string, now = new Date(), opts: { agent?: string | null } = {}): Promise<DemoVisit> {
  const [lead] = await db.select().from(leads).where(and(eq(leads.previewCode, code), eq(leads.simulated, false))).limit(1);
  if (!lead) return { kind: "none" };
  const [last] = await db.select({ sentAt: outreach.sentAt }).from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.simulated, false))).orderBy(desc(outreach.sentAt)).limit(1);
  const sinceSend = last?.sentAt ? now.getTime() - last.sentAt.getTime() : null;
  const burst = !!lead.demoVisitedAt && now.getTime() - lead.demoVisitedAt.getTime() < BURST_MS;
  const scan = (opts.agent ? BOT_AGENT.test(opts.agent) : false) || (sinceSend !== null && sinceSend >= 0 && sinceSend < SCAN_WINDOW_MS) || burst;
  if (scan) {
    await db.update(leads).set({ demoScans: lead.demoScans + 1, updatedAt: now }).where(eq(leads.id, lead.id));
    return { kind: "scan", company: lead.company, leadId: lead.id, visits: lead.demoVisits };
  }
  const visits = lead.demoVisits + 1;
  await db.update(leads).set({ demoVisits: visits, demoVisitedAt: now, updatedAt: now }).where(eq(leads.id, lead.id));
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "demo_visit", message: `${lead.company} opened their demo company${visits > 1 ? ` (visit ${visits})` : ""}`, createdAt: now });
  const quiet = !lead.demoVisitedAt || now.getTime() - lead.demoVisitedAt.getTime() > PING_GAP_MS;
  if (quiet) {
    const who = (lead.decisionMaker as { name?: string } | null)?.name;
    await enqueueMessage(db, {
      kind: "demo_visit",
      body: `${lead.company}${who ? ` (${who})` : ""} opened the demo company we made for them${visits > 1 ? `, visit ${visits}` : ""}.${lead.status === "contacted" ? " No reply yet: the Chaser sends one short nudge tomorrow if they stay quiet." : ""}`,
      now,
    });
  }
  return { kind: "visit", company: lead.company, leadId: lead.id, visits };
}

// They uploaded one of their own documents in the demo: the strongest signal we get before a reply.
export async function recordDemoRead(db: Db, code: string, now = new Date()): Promise<DemoVisit> {
  const [lead] = await db.select().from(leads).where(and(eq(leads.previewCode, code), eq(leads.simulated, false))).limit(1);
  if (!lead) return { kind: "none" };
  await db.update(leads).set({ demoReads: lead.demoReads + 1, demoVisitedAt: lead.demoVisitedAt ?? now, demoVisits: lead.demoVisits || 1, updatedAt: now }).where(eq(leads.id, lead.id));
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "demo_read", message: `${lead.company} read a document of their own in the demo`, createdAt: now });
  await enqueueMessage(db, { kind: "demo_visit", body: `${lead.company} uploaded one of their own documents in the demo and had it read. That is as warm as a cold lead gets: the Chaser nudges them tomorrow if they stay quiet.`, now });
  return { kind: "visit", company: lead.company, leadId: lead.id, visits: lead.demoVisits || 1 };
}
