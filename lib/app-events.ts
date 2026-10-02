// D080: the Doc Ledger app tells the Tower what happened to a company the sales floor brought (signed with
// DEMO_EVENT_KEY): it started its free month, it paid, it cancelled, a payment failed. The lead moves with it,
// the owner hears it, Finance counts it. Nothing here sends an email: the Success agent and the owner do that.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { floors, leads, revenue, taskEvents } from "@/db/schema";
import { enqueueMessage } from "@/lib/telegram";

export type AppEventKind = "signup" | "paid" | "cancelled" | "past_due";

export interface AppEvent {
  kind: AppEventKind;
  orgId?: string;
  company?: string;
  email?: string;
  name?: string;
  monthlyUsd?: number | null;
}

export async function recordAppEvent(db: Db, code: string, ev: AppEvent, now = new Date()): Promise<{ ok: boolean; company?: string; status?: string; note?: string }> {
  const [lead] = await db.select().from(leads).where(and(eq(leads.previewCode, code), eq(leads.simulated, false))).limit(1);
  if (!lead) return { ok: false, note: "no lead for that code" };
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  const who = ev.name && !dm.name ? { name: String(ev.name).slice(0, 80) } : {};
  if (ev.kind === "signup") {
    if (lead.status === "client") return { ok: true, company: lead.company, status: lead.status, note: "already a customer" };
    await db
      .update(leads)
      .set({ status: "trial", decisionMaker: { ...dm, ...who, appOrgId: ev.orgId ?? null, appEmail: ev.email ?? null, trialStart: now.toISOString(), successSteps: [] }, updatedAt: now })
      .where(eq(leads.id, lead.id));
    await db.insert(taskEvents).values({ floorId: lead.floorId, type: "milestone", message: `${lead.company} started the free month in the app${ev.name ? ` (${ev.name})` : ""}`, createdAt: now });
    await enqueueMessage(db, { kind: "trial", body: `${lead.company} just signed up in Doc Ledger${ev.name ? ` (${ev.name}${ev.email ? `, ${ev.email}` : ""})` : ""}. The free month runs 30 days; Success writes the welcome on the next heartbeat and checks in on days 3, 10 and 25.`, now });
    return { ok: true, company: lead.company, status: "trial" };
  }
  if (ev.kind === "paid") {
    const monthly = typeof ev.monthlyUsd === "number" && ev.monthlyUsd > 0 ? ev.monthlyUsd : typeof dm.monthlyUsd === "number" ? dm.monthlyUsd : null;
    const first = lead.status !== "client";
    await db.update(leads).set({ status: "client", decisionMaker: { ...dm, ...who, appOrgId: ev.orgId ?? dm.appOrgId ?? null, ...(monthly ? { monthlyUsd: monthly } : {}), wonAt: typeof dm.wonAt === "string" ? dm.wonAt : now.toISOString(), billing: "paddle" }, updatedAt: now }).where(eq(leads.id, lead.id));
    if (first && monthly) {
      const [floor] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "docledger")).limit(1);
      await db.insert(revenue).values({ floorId: floor?.id ?? lead.floorId, source: "docledger_subscription", amountUsd: monthly.toFixed(2), currency: "USD", verified: true, verifiedAt: now, verifiedBy: "paddle", note: `Card added by ${lead.company} in the app`, leadId: lead.id, simulated: false, occurredAt: now, createdAt: now });
    }
    await db.insert(taskEvents).values({ floorId: lead.floorId, type: "milestone", message: `${lead.company} added a card${monthly ? ` at ${monthly.toFixed(2)} USD a month` : ""}`, createdAt: now });
    if (first) await enqueueMessage(db, { kind: "won", body: `${lead.company} added a card in Doc Ledger${monthly ? `: ${monthly.toFixed(2)} USD a month` : ""}. A paying customer.`, now });
    return { ok: true, company: lead.company, status: "client" };
  }
  if (ev.kind === "cancelled") {
    await db.update(leads).set({ status: "lost", decisionMaker: { ...dm, churnedAt: now.toISOString() }, updatedAt: now }).where(eq(leads.id, lead.id));
    await db.insert(taskEvents).values({ floorId: lead.floorId, type: "log", message: `${lead.company} cancelled the subscription`, createdAt: now });
    await enqueueMessage(db, { kind: "lost", body: `${lead.company} cancelled their Doc Ledger subscription. Worth one personal note from you.`, now });
    return { ok: true, company: lead.company, status: "lost" };
  }
  await db.insert(taskEvents).values({ floorId: lead.floorId, type: "log", message: `${lead.company}: the last payment did not go through`, createdAt: now });
  await enqueueMessage(db, { kind: "billing", body: `${lead.company}: the last card payment failed. Paddle retries; a short note from you helps.`, now });
  return { ok: true, company: lead.company, status: lead.status };
}
