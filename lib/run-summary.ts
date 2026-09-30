// What one tick did and what holds the Tower back, in plain words for the Run the Tower now button and the
// roof banner in the game. Pure: it reads the tick's steps and nothing else.

export type TickSteps = {
  collect?: { collected?: number };
  advance?: { created?: Record<string, number>; executed?: number; deferred?: string[] };
  guard?: { capHit?: boolean; capUsd?: number; todayUsd?: number; resumedFloors?: string[] };
  submit?: { status?: string; reason?: string; submitted?: number; direct?: number; held?: string[]; paused?: string[] };
  deliver?: { sent?: number };
  warden?: { status?: string; reason?: string; summary?: string };
  owner?: { approvals?: number };
};

export interface RunReport {
  // one short line for the banner, and a second one under it
  headline: string;
  sub: string;
  // the rest, one sentence each
  lines: string[];
  // true when nothing could work because of money: the game shows the amber cap light
  capped: boolean;
}

const FLOOR_NAMES: Record<string, string> = { docledger: "DocLedger Sales", growth: "DocLedger Growth", deals: "Deals Engine" };

function floorName(slug: string): string {
  return FLOOR_NAMES[slug] ?? slug;
}

function list(slugs: string[]): string {
  const names = slugs.map(floorName);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Minutes until midnight in Dubai (UTC+4, no summer time), when the daily cap starts over.
export function minutesToDubaiMidnight(now: Date): number {
  const dubai = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const passed = dubai.getUTCHours() * 60 + dubai.getUTCMinutes();
  return 24 * 60 - passed;
}

function inTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function runReport(steps: TickSteps | undefined, now = new Date()): RunReport {
  if (!steps) return { headline: "Done", sub: "", lines: [], capped: false };
  const lines: string[] = [];
  const guard = steps.guard;
  const submit = steps.submit;
  const w = steps.warden;
  const capped = !!guard?.capHit || submit?.reason === "daily cap reached" || w?.status === "held";

  if (guard?.resumedFloors?.length) lines.push(`${list(guard.resumedFloors)} ${guard.resumedFloors.length === 1 ? "is" : "are"} back at work.`);

  const created = Object.entries(steps.advance?.created ?? {})
    .filter(([k]) => !k.endsWith("_error"))
    .reduce((a, [, b]) => a + b, 0);
  const done: string[] = [];
  if (steps.collect?.collected) done.push(`${steps.collect.collected} results came back`);
  if (created) done.push(`${created} new tasks`);
  const worked = submit?.submitted ?? 0;
  const finished = submit?.direct ?? 0;
  if (worked) done.push(finished ? `${worked} tasks worked, ${finished} finished already` : `${worked} tasks sent to work`);
  if (steps.advance?.executed) done.push(`${steps.advance.executed} approved items carried out`);
  if (steps.deliver?.sent) done.push(`${steps.deliver.sent} messages sent to your phone`);
  if (done.length) lines.push(`Floors: ${done.join(", ")}.`);

  // What holds the work back, most important first.
  if (capped) {
    const spent = guard?.todayUsd;
    const cap = guard?.capUsd;
    const money = spent !== undefined && cap !== undefined ? `: ${spent.toFixed(2)} of ${cap.toFixed(2)} USD spent today` : "";
    lines.push(`Daily cap reached${money}. Work starts again at midnight Dubai, in ${inTime(minutesToDubaiMidnight(now))}. To go on now, raise the daily cap in the Budget tab.`);
  } else if (submit?.paused?.length) {
    lines.push(`${list(submit.paused)} ${submit.paused.length === 1 ? "is" : "are"} paused: open the floor and tap Resume.`);
  } else if (submit?.held?.length) {
    lines.push(`${list(submit.held)} used ${submit.held.length === 1 ? "its" : "their"} share of today's budget and waits for tomorrow.`);
  } else if (submit?.reason && /busy worker/.test(submit.reason)) {
    lines.push(`Workers are busy: ${submit.reason}.`);
  }
  const hours = (steps.advance?.deferred ?? []).filter((d) => d.startsWith("waiting for business hours"));
  if (hours.length) lines.push("Approved emails wait for business hours where the reader is.");

  if (w?.status === "applied") lines.push(`Warden: ${w.summary ?? "decisions applied"}`);
  else if (w?.status === "submitted") lines.push("Warden is thinking: his answer lands on a later tick.");
  else if (w?.status === "simulated") lines.push("Warden: simulation is on, paste the Anthropic key and switch it off for a real run.");
  else if (w?.status === "skipped" && /already happened this hour/.test(w.reason ?? "")) lines.push("Warden already thought in the last hour, so he rests until then.");
  else if (w?.status === "failed") lines.push(`Warden failed: ${w.reason ?? "unknown"}`);

  const waiting = steps.owner?.approvals ?? 0;
  if (waiting) lines.push(`${waiting} ${waiting === 1 ? "item waits" : "items wait"} for you on the red phone.`);

  let headline: string;
  let sub: string;
  const phone = waiting ? `${waiting} ${waiting === 1 ? "item" : "items"} on the red phone` : "";
  if (capped) {
    headline = "Daily cap reached";
    sub = `Back at midnight Dubai, in ${inTime(minutesToDubaiMidnight(now))}`;
  } else if (worked) {
    headline = `${worked} ${worked === 1 ? "task" : "tasks"} at work`;
    sub = finished ? `${finished} finished already${phone ? `, ${phone}` : ""}` : phone || "Results land on the next ticks";
  } else if (guard?.resumedFloors?.length) {
    headline = "Floors back at work";
    sub = `${list(guard.resumedFloors)}${phone ? `, ${phone}` : ""}`;
  } else if (submit?.paused?.length) {
    headline = "Floors paused";
    sub = "Open the floor and tap Resume";
  } else if (waiting) {
    headline = `${waiting} waiting on you`;
    sub = "Open the red phone to approve";
  } else {
    headline = "All caught up";
    sub = "Nothing waiting right now";
  }
  if (!lines.length) lines.push("Floors checked: nothing waiting.");
  return { headline, sub, lines, capped };
}

// The whole report as one line, for the note under the button.
export function runSummary(steps: TickSteps | undefined, now = new Date()): string {
  const r = runReport(steps, now);
  return r.lines.join(" ");
}
