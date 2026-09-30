import { getDb } from "@/db/client";
import { bad, json } from "@/lib/http";
import { listThreads, mailboxCounts, threadDetail } from "@/lib/mailbox";
import { mockEnabled, mockMailbox } from "@/lib/mock-state";
import { asBool, getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// ?lead=<id> for one thread, otherwise the list (?filter=all|hot|waiting). Owner only (middleware).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lead = url.searchParams.get("lead");
  const f = url.searchParams.get("filter");
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
