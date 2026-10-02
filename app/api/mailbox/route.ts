import { getDb } from "@/db/client";
import { CALL_OUTCOMES, callSheet, recordCall, type CallOutcome } from "@/lib/callsheet";
import { bad, json, readJson } from "@/lib/http";
import { listThreads, mailboxCounts, threadDetail } from "@/lib/mailbox";
import { mockCallSheet, mockEnabled, mockMailbox } from "@/lib/mock-state";
import { asBool, getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// ?lead=<id> for one thread, ?filter=calls for the owner's call sheet (D079), otherwise the list
// (?filter=all|hot|waiting). Owner only (middleware).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lead = url.searchParams.get("lead");
  const f = url.searchParams.get("filter");
  if (f === "calls") {
    if (mockEnabled()) return json({ ok: true, ...mockCallSheet() });
    return json({ ok: true, ...(await callSheet(getDb())) });
  }
  const filter = f === "hot" || f === "waiting" ? f : "all";
  if (mockEnabled()) {
    const m = mockMailbox();
    if (lead) return m.details[lead] ? json({ ok: true, thread: m.details[lead] }) : bad("Thread not found", 404);
    const threads = filter === "hot" ? m.threads.filter((t) => t.state === "hot") : filter === "waiting" ? m.threads.filter((t) => t.state === "hot" || t.state === "waiting") : m.threads;
    return json({ ok: true, threads, counts: mailboxCounts(m.threads) });
  }
  const db = getDb();
  if (lead) {
    const thread = await threadDetail(db, lead);
    return thread ? json({ ok: true, thread }) : bad("Thread not found", 404);
  }
  const simulated = asBool((await getSettings(db)).simulation_mode, true);
  const all = await listThreads(db, simulated, "all");
  const threads = filter === "all" ? all : await listThreads(db, simulated, filter);
  return json({ ok: true, threads, counts: mailboxCounts(all) });
}

// The owner marks a call: { action: "called", leadId, outcome, note? } (D079).
export async function POST(req: Request) {
  const body = await readJson<{ action?: string; leadId?: string; outcome?: string; note?: string }>(req);
  if (body?.action !== "called") return bad("Unknown action");
  const outcome = (CALL_OUTCOMES as readonly string[]).includes(body.outcome ?? "") ? (body.outcome as CallOutcome) : null;
  if (!body.leadId || !outcome) return bad("leadId and outcome (interested, no_answer, not_now, no) are needed");
  if (mockEnabled()) return json({ ok: true, message: "Noted (mock)." });
  const r = await recordCall(getDb(), body.leadId, outcome, body.note?.trim() || null, new Date());
  return r.ok ? json({ ok: true, message: r.message }) : bad(r.message, 404);
}
