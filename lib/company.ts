// The Company tab (D065): DocLedger seen as a startup. The week's numbers, the team and what each person did last,
// the ideas waiting on the owner and the experiments running, Product's roadmap, the Marketer's pack, customers.
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { appUsageByCode, usageLine } from "@/lib/app-usage";
import type { Db } from "@/db/client";
import { agents, approvals, floors, leads, tasks } from "@/db/schema";
import { allExperiments } from "@/agents/experiments";
import { founderNumbers, type FounderNumbers } from "@/agents/growth";
import { currentRoadmap, type MarketingPack, type RoadmapItem } from "@/agents/growth-playbooks";
import { getSettings } from "@/lib/settings";
import { socialView, type SocialView } from "@/agents/social";

export interface CompanyView {
  numbers: FounderNumbers;
  team: Array<{ id: string; name: string; role: string; floor: "Sales" | "Growth"; status: string; lastWork: string | null; lastAt: string | null; doneWeek: number }>;
  ideas: Array<{ id: string; title: string; owner: string; state: "waiting" | "running" | "ended"; why: string; endsAt: string | null }>;
  roadmap: RoadmapItem[];
  marketing: MarketingPack | null;
  report: { at: string; text: string } | null;
  customers: Array<{ id: string; company: string; country: string; status: "trial" | "client"; since: string | null; monthlyUsd: number | null; plan: string | null; usage: string | null; trialEndsAt: string | null }>;
  social: SocialView;
}

const DAY_MS = 24 * 3600 * 1000;

export async function companyView(db: Db, now = new Date()): Promise<CompanyView> {
  const s = await getSettings(db);
  const floorRows = await db.select({ id: floors.id, slug: floors.slug }).from(floors).where(inArray(floors.slug, ["docledger", "growth"]));
  const floorSlug = new Map(floorRows.map((f) => [f.id, f.slug]));
  const crew = floorRows.length ? await db.select().from(agents).where(inArray(agents.floorId, floorRows.map((f) => f.id))) : [];
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const team: CompanyView["team"] = [];
  for (const a of crew) {
    const [last] = await db
      .select({ output: tasks.output, title: tasks.title, at: tasks.finishedAt })
      .from(tasks)
      .where(and(eq(tasks.agentId, a.id), eq(tasks.simulated, false), inArray(tasks.status, ["review", "done"])))
      .orderBy(desc(tasks.finishedAt))
      .limit(1);
    const [week] = await db.select({ n: sql<string>`count(*)` }).from(tasks).where(and(eq(tasks.agentId, a.id), eq(tasks.simulated, false), inArray(tasks.status, ["review", "done"]), gte(tasks.finishedAt, weekAgo)));
    const summary = last ? ((last.output ?? {}) as Record<string, unknown>).summary : null;
    team.push({
      id: a.id,
      name: a.name,
      role: a.role,
      floor: floorSlug.get(a.floorId ?? "") === "growth" ? "Growth" : "Sales",
      status: a.status,
      lastWork: last ? (typeof summary === "string" && summary ? summary : last.title) : null,
      lastAt: last?.at?.toISOString() ?? null,
      doneWeek: Number(week?.n ?? 0),
    });
  }
  team.sort((x, y) => (x.floor === y.floor ? 0 : x.floor === "Sales" ? -1 : 1));

  const waiting = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.type, "decision"), eq(approvals.status, "pending"), eq(approvals.simulated, false), sql`(${approvals.content} -> 'growthIdea') is not null`))
    .orderBy(desc(approvals.createdAt))
    .limit(10);
  const ideas: CompanyView["ideas"] = waiting.map((a) => {
    const idea = ((a.content ?? {}) as Record<string, unknown>).growthIdea as Record<string, unknown>;
    return { id: a.id, title: String(idea.title ?? a.summary), owner: String(idea.owner ?? ""), state: "waiting", why: String(idea.why ?? ""), endsAt: null };
  });
  for (const e of (await allExperiments(db)).slice(0, 12)) {
    ideas.push({ id: e.approvalId, title: e.title, owner: e.owner, state: Date.parse(e.endsAt) > now.getTime() ? "running" : "ended", why: e.why, endsAt: e.endsAt });
  }

  const clientRows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.simulated, false), inArray(leads.status, ["trial", "client"])))
    .orderBy(desc(leads.updatedAt))
    .limit(20);
  // D080: the app's own numbers for the companies that signed up through their sales code
  const usage = await appUsageByCode(db, clientRows.map((l) => l.previewCode).filter((c): c is string => !!c));
  const customers: CompanyView["customers"] = clientRows.map((l) => {
    const dm = (l.decisionMaker ?? {}) as Record<string, unknown>;
    const since = l.status === "client" ? dm.wonAt : dm.trialStart;
    const u = l.previewCode ? usage.get(l.previewCode) : undefined;
    return { id: l.id, company: l.company, country: l.country, status: l.status as "trial" | "client", since: typeof since === "string" ? since : null, monthlyUsd: typeof dm.monthlyUsd === "number" ? dm.monthlyUsd : null, plan: u?.plan ?? null, usage: u ? usageLine(u, now) : null, trialEndsAt: u?.trialEndsAt ?? null };
  });

  const report = s.founder_report as { at?: string; text?: string } | null;
  return {
    numbers: await founderNumbers(db, now),
    team,
    ideas,
    roadmap: await currentRoadmap(db),
    marketing: (s.docledger_marketing as MarketingPack | null) ?? null,
    report: report?.at && report.text ? { at: report.at, text: report.text } : null,
    customers,
    social: await socialView(db, now),
  };
}
