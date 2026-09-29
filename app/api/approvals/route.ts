import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals } from "@/db/schema";
import { bad, json, readJson } from "@/lib/http";
import { applyApprovalDecision } from "@/sim/generator";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const rows = await getDb().select().from(approvals).where(eq(approvals.status, status)).orderBy(desc(approvals.createdAt)).limit(100);
  return json({ ok: true, approvals: rows });
}

// Body: { id, decision: "approved" | "rejected", feedback? }
export async function POST(req: Request) {
  const body = await readJson<{ id?: string; decision?: string; feedback?: string }>(req);
  if (!body?.id || (body.decision !== "approved" && body.decision !== "rejected")) return bad("id and decision (approved or rejected) are required");
  if (body.decision === "rejected" && !body.feedback?.trim()) return bad("A line of feedback is required to reject");
  const result = await applyApprovalDecision(getDb(), body.id, body.decision, body.feedback?.trim() ?? null, "ui");
  if (!result) return bad("Approval not found or already decided", 404);
  return json({ ok: true, ...result });
}
