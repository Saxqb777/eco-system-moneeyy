import { getDb } from "@/db/client";
import { getAgentDetail, renameAgent } from "@/lib/detail";
import { bad, json, readJson } from "@/lib/http";
import { mockAgentDetail, mockEnabled } from "@/lib/mock-state";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The character panel: one worker or the Warden, with the live log, history, cost today and stats.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (mockEnabled()) {
    const agent = mockAgentDetail(id);
    return agent ? json({ ok: true, agent }) : bad("Worker not found", 404);
  }
  const agent = await getAgentDetail(getDb(), id);
  return agent ? json({ ok: true, agent }) : bad("Worker not found", 404);
}

// Body: { name }. The editable name plate.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJson<{ name?: unknown }>(req);
  if (!body || body.name === undefined) return bad("name is required");
  if (mockEnabled()) return json({ ok: true, name: String(body.name).trim() });
  const result = await renameAgent(getDb(), id, body.name);
  if (!result.ok) return bad(result.error);
  return json({ ok: true, name: result.name });
}
