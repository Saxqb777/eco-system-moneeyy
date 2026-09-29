// One line descriptions of task output, shared by the simulation and the panels.

export function describeTaskOutput(kind: string, output: Record<string, unknown> | null | undefined, rejected = false): string {
  const o = output ?? {};
  if (rejected) return "Draft output ready for review";
  switch (kind) {
    case "find_leads":
      return `Found ${o.found ?? 0} new leads`;
    case "qualify_lead":
      return o.company ? `Scored ${o.company}: ${o.score}/10` : "No new lead to qualify";
    case "draft_outreach":
      return o.company ? `Outreach drafted for ${o.company}, waiting for approval` : "No qualified lead waiting";
    case "follow_up":
      return String(o.result ?? "Follow up logged");
    case "build_ticket":
      return o.title ? `Pull request opened: ${o.title}` : "No ticket in the backlog";
    case "find_deals":
      return `Found ${o.found ?? 0} deals`;
    case "write_post":
      return o.title ? `Post drafted: ${o.title}` : "No deal waiting for a post";
    case "publish_post":
      return o.posted ? `Posted to the channel, ${o.clicks} clicks so far` : "Nothing approved to publish yet";
    default:
      return "Task finished";
  }
}

// Names Saaqib can give a worker: short, plain, no control characters.
export function validateAgentName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Name must be text" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2) return { ok: false, error: "Name needs at least 2 characters" };
  if (name.length > 24) return { ok: false, error: "Name can be 24 characters at most" };
  if (!/^[\p{L}\p{N} .'’]+$/u.test(name)) return { ok: false, error: "Letters, numbers, spaces, dots and apostrophes only" };
  return { ok: true, name };
}
