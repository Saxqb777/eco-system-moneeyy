// The DocLedger Growth floor's rhythm (D065): who works when, the owner's /trial, /won and /lost, what happens when he
// approves an idea or a ticket, and Finance's numbers. Finance uses no model: every number comes from the tables.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agents, approvals, budgetLedger, floors, leads, outreach, revenue, taskEvents, tasks, tickets } from "@/db/schema";
import { getSettings, setSetting } from "@/lib/settings";
import { enqueueMessage } from "@/lib/telegram";
import { dubaiParts } from "@/lib/time";
import { OWNER_AGENT, OWNER_LABEL, isIdeaOwner, startExperiment, type GrowthIdea } from "./experiments";
import { SUCCESS_STEPS } from "./growth-playbooks";

const DAY_MS = 24 * 3600 * 1000;
export const PARTNERS_EVERY_DAYS = 2;
export const MARKETING_EVERY_DAYS = 7;
export const REPORT_EVERY_DAYS = 7;

async function logEvent(db: Db, e: { taskId?: string | null; agentId?: string | null; floorId?: string | null; type: string; message: string; at: Date }) {
  await db.insert(taskEvents).values({ taskId: e.taskId ?? null, agentId: e.agentId ?? null, floorId: e.floorId ?? null, type: e.type, message: e.message, createdAt: e.at });
}

async function queue(db: Db, floorId: string, agentId: string, kind: string, title: string, input: Record<string, unknown>, priority: number, now: Date) {
  const [row] = await db.insert(tasks).values({ floorId, agentId, kind, title: title.slice(0, 60), status: "queued", priority, input, simulated: false, createdAt: now, updatedAt: now }).returning({ id: tasks.id });
  await logEvent(db, { taskId: row?.id, agentId, floorId, type: "created", message: `${title} queued`, at: now });
}

async function openOfKind(db: Db, kind: string, extra?: ReturnType<typeof sql>, statuses = ["queued", "running", "review"]): Promise<number> {
  const [r] = await db
    .select({ n: sql<string>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.kind, kind), eq(tasks.simulated, false), inArray(tasks.status, statuses), ...(extra ? [extra] : [])));
  return Number(r?.n ?? 0);
}

async function lastCreated(db: Db, kind: string): Promise<Date | null> {
  const [r] = await db.select({ at: tasks.createdAt }).from(tasks).where(and(eq(tasks.kind, kind), eq(tasks.simulated, false))).orderBy(desc(tasks.createdAt)).limit(1);
  return r?.at ?? null;
}

const olderThan = (at: Date | null, now: Date, days: number) => !at || now.getTime() - at.getTime() >= days * DAY_MS - 30 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------------
// Finance: the founder's numbers.
export interface FounderNumbers {
  from: string;
  to: string;
  leads: number;
  partners: number;
  // D081: the funnel, stage by stage
  emailable: number;
  emailsSent: number;
  delivered: number;
  bounced: number;
  demoOpens: number;
  replies: number;
  demos: number;
  costPerEmailUsd: number | null;
  costPerDemoOpenUsd: number | null;
  trials: number;
  clients: number;
  mrrUsd: number;
  revenueUsd: number;
  spendUsd: number;
  costPerLeadUsd: number | null;
  costPerReplyUsd: number | null;
  allTime: { leads: number; emailsSent: number; replies: number; clients: number; revenueUsd: number; spendUsd: number };
}

export async function founderNumbers(db: Db, now: Date, days = 7): Promise<FounderNumbers> {
  const from = new Date(now.getTime() - days * DAY_MS);
  const n = async (q: Promise<Array<{ n: string | null }>>) => Number((await q)[0]?.n ?? 0);
  const leadsIn = (since: Date) => n(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), gte(leads.createdAt, since), sql`coalesce(${leads.segment}, '') not like 'partner%'`)));
  const sentIn = (since: Date) => n(db.select({ n: sql<string>`count(*)` }).from(outreach).where(and(eq(outreach.simulated, false), gte(outreach.sentAt, since))));
  const repliesIn = (since: Date) => n(db.select({ n: sql<string>`count(*)` }).from(outreach).where(and(eq(outreach.simulated, false), gte(outreach.replyAt, since))));
  const revenueIn = (since: Date) => n(db.select({ n: sql<string>`coalesce(sum(${revenue.amountUsd}), 0)` }).from(revenue).where(and(eq(revenue.simulated, false), eq(revenue.verified, true), gte(revenue.occurredAt, since))));
  const spendIn = (since: Date) => n(db.select({ n: sql<string>`coalesce(sum(${budgetLedger.amountUsd}), 0)` }).from(budgetLedger).where(and(eq(budgetLedger.simulated, false), eq(budgetLedger.kind, "api_cost"), gte(budgetLedger.occurredAt, since))));
  const epoch = new Date(0);
  const leadsWeek = await leadsIn(from);
  const repliesWeek = await repliesIn(from);
  const spendWeek = await spendIn(from);
  const sentWeek = await sentIn(from);
  const demoOpensWeek = await n(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), gte(leads.demoVisitedAt, from))));
  const clientRows = await db.select({ dm: leads.decisionMaker }).from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "client")));
  const mrr = clientRows.reduce((sum, r) => sum + Number(((r.dm ?? {}) as Record<string, unknown>).monthlyUsd ?? 0), 0);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    leads: leadsWeek,
    partners: await n(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), gte(leads.createdAt, from), sql`coalesce(${leads.segment}, '') like 'partner%'`))),
    emailable: await n(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), gte(leads.createdAt, from), sql`coalesce(${leads.decisionMaker} ->> 'email', '') <> ''`))),
    emailsSent: sentWeek,
    costPerEmailUsd: sentWeek ? round(spendWeek / sentWeek) : null,
    costPerDemoOpenUsd: demoOpensWeek ? round(spendWeek / demoOpensWeek) : null,
    delivered: await n(db.select({ n: sql<string>`count(*)` }).from(outreach).where(and(eq(outreach.simulated, false), gte(outreach.deliveredAt, from)))),
    bounced: await n(db.select({ n: sql<string>`count(*)` }).from(outreach).where(and(eq(outreach.simulated, false), eq(outreach.status, "bounced"), gte(outreach.updatedAt, from)))),
    demoOpens: demoOpensWeek,
    replies: repliesWeek,
    demos: await n(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "demo_booked"), gte(leads.updatedAt, from)))),
    trials: await n(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "trial")))),
    clients: clientRows.length,
    mrrUsd: round(mrr),
    revenueUsd: round(await revenueIn(from)),
    spendUsd: round(spendWeek),
    costPerLeadUsd: leadsWeek ? round(spendWeek / leadsWeek) : null,
    costPerReplyUsd: repliesWeek ? round(spendWeek / repliesWeek) : null,
    allTime: { leads: await leadsIn(epoch), emailsSent: await sentIn(epoch), replies: await repliesIn(epoch), clients: clientRows.length, revenueUsd: round(await revenueIn(epoch)), spendUsd: round(await spendIn(epoch)) },
  };
}

export function formatFounderReport(f: FounderNumbers): string {
  const money = (v: number) => `${v.toFixed(2)} USD`;
  return [
    "Founder report from Finance, last 7 days",
    `The funnel: found ${f.leads}, with an address ${f.emailable}, sent ${f.emailsSent}, delivered ${f.delivered}, bounced ${f.bounced}, opened their demo ${f.demoOpens}, replied ${f.replies}, demos booked ${f.demos}, in their free month ${f.trials}, paying ${f.clients}`,
    `Partners found: ${f.partners}. Monthly revenue: ${money(f.mrrUsd)}`,
    `Money in: ${money(f.revenueUsd)}, AI spend: ${money(f.spendUsd)}`,
    `Cost per stage: lead ${f.costPerLeadUsd !== null ? money(f.costPerLeadUsd) : "none yet"}, email ${f.costPerEmailUsd !== null ? money(f.costPerEmailUsd) : "none yet"}, demo opened ${f.costPerDemoOpenUsd !== null ? money(f.costPerDemoOpenUsd) : "none yet"}, reply ${f.costPerReplyUsd !== null ? money(f.costPerReplyUsd) : "none yet"}`,
    `Since the start: ${f.allTime.leads} leads, ${f.allTime.emailsSent} emails, ${f.allTime.replies} replies, ${f.allTime.clients} customers, ${money(f.allTime.revenueUsd)} in, ${money(f.allTime.spendUsd)} spent`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// The floor's day: Head of Growth from 10:00 Dubai, Partners every two days, Product daily from 11:00, Marketer
// weekly, Success on the free month's calendar, Finance's numbers every morning and the report every seven days.
export async function advanceGrowth(db: Db, now: Date, created: Record<string, number>): Promise<void> {
  const [floor] = await db.select().from(floors).where(eq(floors.slug, "growth")).limit(1);
  if (!floor || floor.status !== "live") return;
  const crew = await db.select().from(agents).where(eq(agents.floorId, floor.id));
  const by = new Map(crew.map((a) => [a.slug, a]));
  const p = dubaiParts(now);
  const s = await getSettings(db);
  const bump = (k: string) => (created[k] = (created[k] ?? 0) + 1);

  const lead = by.get("growth_lead");
  if (lead && p.hour >= 10 && s.pipeline_day_growth !== p.dayKey) {
    if ((await openOfKind(db, "growth_ideas")) === 0) {
      await queue(db, floor.id, lead.id, "growth_ideas", "Bring today's growth ideas", {}, 4, now);
      bump("growth_ideas");
    }
    await setSetting(db, "pipeline_day_growth", p.dayKey);
  }

  const partners = by.get("growth_partners");
  if (partners && p.hour >= 9 && (await openOfKind(db, "find_partners")) === 0 && olderThan(await lastCreated(db, "find_partners"), now, PARTNERS_EVERY_DAYS)) {
    await queue(db, floor.id, partners.id, "find_partners", "Find referral partners", {}, 5, now);
    bump("find_partners");
  }

  const product = by.get("growth_product");
  if (product && p.hour >= 11 && s.pipeline_day_product !== p.dayKey) {
    if ((await openOfKind(db, "product_review")) === 0) {
      await queue(db, floor.id, product.id, "product_review", "Review the market's feedback", {}, 5, now);
      bump("product_review");
    }
    await setSetting(db, "pipeline_day_product", p.dayKey);
  }

  const marketer = by.get("growth_marketer");
  if (marketer && p.hour >= 12 && (await openOfKind(db, "marketing_pack")) === 0 && olderThan(await lastCreated(db, "marketing_pack"), now, MARKETING_EVERY_DAYS)) {
    await queue(db, floor.id, marketer.id, "marketing_pack", "Write this week's posts", {}, 5, now);
    bump("marketing_pack");
  }

  const success = by.get("growth_success");
  if (success) {
    const trials = await db.select().from(leads).where(and(eq(leads.simulated, false), eq(leads.status, "trial"))).limit(20);
    for (const t of trials) {
      const dm = (t.decisionMaker ?? {}) as Record<string, unknown>;
      const start = Date.parse(String(dm.trialStart ?? ""));
      if (!Number.isFinite(start)) continue;
      const day = Math.floor((now.getTime() - start) / DAY_MS);
      const done = new Set(Array.isArray(dm.successSteps) ? (dm.successSteps as string[]) : []);
      // The latest step that is due and not done yet; earlier missed ones are skipped, never sent late in a row.
      const due = [...SUCCESS_STEPS].reverse().find((st) => day >= st.day && !done.has(st.key));
      if (!due) continue;
      // Only a step still being written blocks the next one; a finished draft waiting for review does not.
      if ((await openOfKind(db, "success_email", sql`${tasks.input} ->> 'leadId' = ${t.id}`, ["queued", "running"])) > 0) continue;
      await queue(db, floor.id, success.id, "success_email", `${due.label}: ${t.company}`, { leadId: t.id, step: due.key }, 3, now);
      bump("success_email");
    }
  }

  const finance = by.get("growth_finance");
  if (finance && p.hour >= 8 && s.pipeline_day_finance !== p.dayKey) {
    await setSetting(db, "pipeline_day_finance", p.dayKey);
    const numbers = await founderNumbers(db, now);
    const reportDue = olderThan(s.founder_report_at ? new Date(String(s.founder_report_at)) : null, now, REPORT_EVERY_DAYS);
    const summary = `Numbers: ${numbers.leads} leads, ${numbers.emailsSent} emails, ${numbers.replies} replies this week, ${numbers.spendUsd.toFixed(2)} USD spent`;
    const [row] = await db
      .insert(tasks)
      .values({ floorId: floor.id, agentId: finance.id, kind: "founder_report", title: reportDue ? "Weekly founder report" : "Count the numbers", status: "done", priority: 5, input: {}, output: { summary, numbers }, startedAt: now, finishedAt: now, simulated: false, createdAt: now, updatedAt: now })
      .returning({ id: tasks.id });
    await db.update(agents).set({ tasksDone: sql`${agents.tasksDone} + 1`, updatedAt: now }).where(eq(agents.id, finance.id));
    await logEvent(db, { taskId: row?.id, agentId: finance.id, floorId: floor.id, type: "output", message: summary, at: now });
    if (reportDue) {
      const text = formatFounderReport(numbers);
      await enqueueMessage(db, { kind: "founder_report", body: text, now });
      await setSetting(db, "founder_report_at", now.toISOString());
      await setSetting(db, "founder_report", { at: now.toISOString(), numbers, text });
    }
    bump("founder_report");
  }

  // Social runs the DocLedger Facebook Page (D074).
  const { advanceSocial } = await import("./social");
  await advanceSocial(db, floor, now, created);
}

// ---------------------------------------------------------------------------------------------------------------
// On the owner's yes: an idea becomes a running experiment, and the teammates with their own jobs start on it now.
export async function onIdeaApproved(db: Db, approval: typeof approvals.$inferSelect, now: Date): Promise<Record<string, unknown>> {
  const content = (approval.content ?? {}) as Record<string, unknown>;
  const raw = content.growthIdea as Partial<GrowthIdea> | undefined;
  if (!raw || !isIdeaOwner(raw.owner)) return { skipped: "no idea in the item" };
  const idea: GrowthIdea = { title: String(raw.title ?? ""), why: String(raw.why ?? ""), experiment: String(raw.experiment ?? ""), metric: String(raw.metric ?? ""), owner: raw.owner, instructions: String(raw.instructions ?? ""), days: Number(raw.days ?? 14) };
  const exp = await startExperiment(db, idea, approval.id, now);
  const [agent] = await db.select().from(agents).where(eq(agents.slug, OWNER_AGENT[idea.owner])).limit(1);
  const kinds: Partial<Record<typeof idea.owner, string>> = { partners: "find_partners", product: "product_review", marketer: "marketing_pack" };
  const kind = kinds[idea.owner];
  if (agent?.floorId && kind) await queue(db, agent.floorId, agent.id, kind, `Experiment: ${idea.title}`, { instructions: idea.instructions, experimentId: exp.id }, 3, now);
  await logEvent(db, { agentId: agent?.id ?? null, floorId: agent?.floorId ?? null, type: "log", message: `Experiment started for ${OWNER_LABEL[idea.owner]}: ${idea.title}, until ${exp.endsAt.slice(0, 10)}`, at: now });
  return { experiment: exp.id, owner: idea.owner, endsAt: exp.endsAt };
}

export async function onTicketDecided(db: Db, ticketId: string, approved: boolean, now: Date): Promise<void> {
  await db.update(tickets).set({ status: approved ? "backlog" : "rejected", updatedAt: now }).where(and(eq(tickets.id, ticketId), eq(tickets.status, "proposed")));
}

// ---------------------------------------------------------------------------------------------------------------
// The owner's word on a company: /trial starts the free month, /won makes it a paying customer, /lost closes it.
async function findLead(db: Db, name: string) {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const rows = await db.select().from(leads).where(and(eq(leads.simulated, false), sql`lower(${leads.company}) like ${`%${needle}%`}`)).orderBy(desc(leads.updatedAt)).limit(5);
  return rows.find((l) => l.company.toLowerCase() === needle) ?? rows[0] ?? null;
}

export async function ownerMarksLead(db: Db, action: "trial" | "won" | "lost", company: string, monthlyUsd: number | null, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const lead = await findLead(db, company);
  if (!lead) return { ok: false, message: `No company matches "${company.trim()}". Check the name in the Mailbox tab.` };
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  if (action === "trial") {
    await db.update(leads).set({ status: "trial", decisionMaker: { ...dm, trialStart: now.toISOString(), successSteps: [] }, updatedAt: now }).where(eq(leads.id, lead.id));
    await logEvent(db, { floorId: lead.floorId, type: "log", message: `${lead.company} started the free month`, at: now });
    return { ok: true, message: `${lead.company} is in the free month. Success drafts the welcome email on the next heartbeat, then check ins on days 3 and 10 and the paid offer on day 25.` };
  }
  if (action === "lost") {
    await db.update(leads).set({ status: "lost", updatedAt: now }).where(eq(leads.id, lead.id));
    return { ok: true, message: `${lead.company} is closed as lost. Nobody writes to them again.` };
  }
  if (!monthlyUsd || !(monthlyUsd > 0)) return { ok: false, message: "Format: /won <company> <USD a month>, for example /won LBX Logistics 99" };
  await db.update(leads).set({ status: "client", decisionMaker: { ...dm, monthlyUsd, wonAt: now.toISOString() }, updatedAt: now }).where(eq(leads.id, lead.id));
  const [floor] = await db.select({ id: floors.id }).from(floors).where(eq(floors.slug, "docledger")).limit(1);
  await db.insert(revenue).values({ floorId: floor?.id ?? lead.floorId, source: "docledger_subscription", amountUsd: monthlyUsd.toFixed(2), currency: "USD", verified: true, verifiedAt: now, verifiedBy: "owner", note: `First month paid by ${lead.company}`, leadId: lead.id, simulated: false, occurredAt: now, createdAt: now });
  const f = await founderNumbers(db, now);
  await logEvent(db, { floorId: lead.floorId, type: "log", message: `${lead.company} became a paying customer at ${monthlyUsd.toFixed(2)} USD a month`, at: now });
  return { ok: true, message: `${lead.company} is a paying customer at ${monthlyUsd.toFixed(2)} USD a month. Monthly revenue now ${f.mrrUsd.toFixed(2)} USD from ${f.clients} customer${f.clients === 1 ? "" : "s"}.` };
}

// ---------------------------------------------------------------------------------------------------------------
// The morning stand up: what each DocLedger teammate finished in the last 24 hours, one line each.
export async function standUp(db: Db, now: Date): Promise<string[]> {
  const floorRows = await db.select({ id: floors.id }).from(floors).where(inArray(floors.slug, ["docledger", "growth"]));
  if (!floorRows.length) return [];
  const crew = await db.select().from(agents).where(inArray(agents.floorId, floorRows.map((f) => f.id)));
  const since = new Date(now.getTime() - DAY_MS);
  const lines: string[] = [];
  for (const a of crew) {
    const done = await db
      .select({ output: tasks.output, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.agentId, a.id), eq(tasks.simulated, false), inArray(tasks.status, ["review", "done"]), gte(tasks.finishedAt, since)))
      .orderBy(desc(tasks.finishedAt))
      .limit(20);
    if (!done.length) continue;
    const last = ((done[0]!.output ?? {}) as Record<string, unknown>).summary;
    lines.push(`${a.name}: ${done.length} done${typeof last === "string" && last ? `, last: ${last.slice(0, 90)}` : `, last: ${done[0]!.title}`}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// What Warden sees of the company each run, and what the Company tab starts from.
export interface CompanyPulse {
  pendingIdeas: number;
  experiments: Array<{ title: string; owner: string; endsAt: string }>;
  roadmapTop: string[];
  partnersTotal: number;
  trials: number;
  clients: number;
  mrrUsd: number;
  // The DocLedger Facebook Page (D074)
  social: { connected: boolean; autoPost: boolean; followers: number | null; postsWeek: number; viewsWeek: number; reactionsWeek: number; commentsWeek: number };
}

export async function companyPulse(db: Db, now: Date): Promise<CompanyPulse> {
  const { pendingIdeaTitles, currentRoadmap } = await import("./growth-playbooks");
  const { activeExperiments } = await import("./experiments");
  const n = async (q: Promise<Array<{ n: string }>>) => Number((await q)[0]?.n ?? 0);
  const f = await founderNumbers(db, now);
  return {
    pendingIdeas: (await pendingIdeaTitles(db)).length,
    experiments: (await activeExperiments(db, now)).map((e) => ({ title: e.title, owner: e.owner, endsAt: e.endsAt.slice(0, 10) })),
    roadmapTop: (await currentRoadmap(db)).slice(0, 3).map((r) => `${r.title} (${r.priority})`),
    partnersTotal: await n(db.select({ n: sql<string>`count(*)` }).from(leads).where(and(eq(leads.simulated, false), sql`coalesce(${leads.segment}, '') like 'partner%'`))),
    trials: f.trials,
    clients: f.clients,
    mrrUsd: f.mrrUsd,
    social: await (async () => {
      const { socialView } = await import("./social");
      const v = await socialView(db, now);
      return { connected: v.connected, autoPost: v.autoPost, followers: v.followers, postsWeek: v.week.posts, viewsWeek: v.week.views, reactionsWeek: v.week.reactions, commentsWeek: v.week.comments };
    })(),
  };
}
