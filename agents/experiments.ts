// Growth experiments: an idea the Head of Growth brought and the owner approved. While it runs, the teammate it
// belongs to reads it before every task (a Scout focus, a Writer angle, a partner type), and when it ends the
// Head of Growth looks at what it did. Stored in settings.docledger_experiments.
import type { Db } from "@/db/client";
import { getSettings, setSetting } from "@/lib/settings";

export const IDEA_OWNERS = ["scout", "analyst", "writer", "chaser", "partners", "product", "marketer", "success"] as const;
export type IdeaOwner = (typeof IDEA_OWNERS)[number];

// Which agent carries an idea for each owner role.
export const OWNER_AGENT: Record<IdeaOwner, string> = {
  scout: "docledger_scout",
  analyst: "docledger_analyst",
  writer: "docledger_writer",
  chaser: "docledger_chaser",
  partners: "growth_partners",
  product: "growth_product",
  marketer: "growth_marketer",
  success: "growth_success",
};

export const OWNER_LABEL: Record<IdeaOwner, string> = {
  scout: "Scout",
  analyst: "Analyst",
  writer: "Writer",
  chaser: "Chaser",
  partners: "Partners",
  product: "Product",
  marketer: "Marketer",
  success: "Success",
};

export interface GrowthIdea {
  title: string;
  why: string;
  experiment: string;
  metric: string;
  owner: IdeaOwner;
  instructions: string;
  days: number;
}

export interface Experiment extends GrowthIdea {
  id: string;
  approvalId: string;
  startedAt: string;
  endsAt: string;
}

export function isIdeaOwner(v: unknown): v is IdeaOwner {
  return typeof v === "string" && (IDEA_OWNERS as readonly string[]).includes(v);
}

export async function allExperiments(db: Db): Promise<Experiment[]> {
  const s = await getSettings(db);
  return Array.isArray(s.docledger_experiments) ? (s.docledger_experiments as Experiment[]) : [];
}

export async function activeExperiments(db: Db, now: Date, owner?: IdeaOwner): Promise<Experiment[]> {
  return (await allExperiments(db)).filter((e) => Date.parse(e.endsAt) > now.getTime() && (!owner || e.owner === owner));
}

// The lines a worker reads before its task. Empty when nothing runs for it.
export async function experimentLines(db: Db, now: Date, owner: IdeaOwner): Promise<string> {
  const list = await activeExperiments(db, now, owner);
  if (!list.length) return "";
  return `Running experiments the founder approved for you (follow them in this task):\n${list.map((e) => `- ${e.title}: ${e.instructions}`).join("\n")}\n`;
}

export async function startExperiment(db: Db, idea: GrowthIdea, approvalId: string, now: Date): Promise<Experiment> {
  const days = Math.min(21, Math.max(7, Math.round(idea.days || 14)));
  const exp: Experiment = { ...idea, days, id: approvalId.slice(0, 8), approvalId, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + days * 24 * 3600 * 1000).toISOString() };
  // Keep the last 30: running ones and the recently ended ones the Head of Growth reviews.
  const list = [exp, ...(await allExperiments(db)).filter((e) => e.approvalId !== approvalId)].slice(0, 30);
  await setSetting(db, "docledger_experiments", list);
  return exp;
}
