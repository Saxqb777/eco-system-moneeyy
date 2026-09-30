import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { bad, json, readJson } from "@/lib/http";
import { mockApprovals, mockEnabled } from "@/lib/mock-state";
import { asBool, getSettings } from "@/lib/settings";
import { applyApprovalDecision } from "@/lib/approvals";

export const dynamic = "force-dynamic";

// ?status=pending (default) or ?status=decided for the last approved and rejected items.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  if (mockEnabled()) return json({ ok: true, approvals: mockApprovals(status) });
  const db = getDb();
  const simulated = asBool((await getSettings(db)).simulation_mode, true);
  const rows =
    status === "decided"
      ? await db.select().from(approvals).where(and(inArray(approvals.status, ["approved", "rejected"]), eq(approvals.simulated, simulated))).orderBy(desc(approvals.decidedAt)).limit(30)
      : await db.select().from(approvals).where(and(eq(approvals.status, status), eq(approvals.simulated, simulated))).orderBy(desc(approvals.createdAt)).limit(100);
  return json({ ok: true, approvals: rows });
}

// Body: { id, decision: "approved" | "rejected", feedback? }
export async function POST(req: Request) {
  const body = await readJson<{ id?: string; decision?: string; feedback?: string }>(req);
  if (!body?.id || (body.decision !== "approved" && body.decision !== "rejected")) return bad("id and decision (approved or rejected) are required");
  if (body.decision === "rejected" && !body.feedback?.trim()) return bad("A line of feedback is required to reject");
  if (mockEnabled()) return json({ ok: true, id: body.id, status: body.decision });
  const result = await applyApprovalDecision(getDb(), body.id, body.decision, body.feedback?.trim() ?? null, "ui");
  if (!result) return bad("Approval not found or already decided", 404);
  return json({ ok: true, ...result });
}
