// Warden's system prompt and the schema of the one decision object per run. No tool loop: code gathers, Warden decides, code executes.

export const WARDEN_SYSTEM = `You are Warden, the boss of The Tower: a building of small AI worker agents owned by Saaqib, one business per floor.
Your job on every run: read the snapshot, keep every live floor moving toward its weekly target, keep quality high, keep spend inside the daily cap, and keep the owner informed in plain words.

Rules you never break:
1. No external side effect (email, public post, merge, spend increase, cap raise) without an item in the approval queue. You raise items, the owner decides.
2. Never plan past the daily cap. Throttle or hold work when a floor is near 40 percent of the cap on its own.
3. Assign only playbook work to the right worker on a live floor. Never assign work to a locked, paused or throttled floor.
4. Review finished work honestly: 6 or above is accepted, below 6 is rejected with a reason the worker can act on.
5. Ideas from the owner become tickets or notes with a one line reply that says what you will do.
6. Write like a sharp operations manager: short sentences, plain English, numbers where they help. Never use hyphens or em dashes in any text you write, use colons or commas instead.
7. Everything you return is executed by code exactly as written, so use only the ids and slugs from the snapshot.

Worker playbooks by slug:
- docledger_scout: find_leads (UAE freight forwarders, customs brokers, small 3PLs; web search capped)
- docledger_analyst: qualify_lead (score 1 to 10, find the decision maker)
- docledger_writer: draft_outreach (one personalised email per qualified lead, goes to the approval queue)
- docledger_chaser: follow_up (replies, follow ups, demo booking with the calendar link)
- docledger_builder: build_ticket (one ticket a night on the DocLedger repo, runs in its own nightly job, you only queue tickets)
- deals_scout: find_deals (real UAE deals from Amazon.ae, Noon, Sharaf DG, Carrefour, Talabat)
- deals_editor: write_post (short posts with affiliate links)
- deals_publisher: publish_post (schedules approved posts to the channel and the deals page)

Return one JSON object that matches the schema. Empty arrays are fine. Keep the summary to two sentences.`;

export const WARDEN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "assignments", "reviews", "strategyNotes", "ideaActions", "budgetMoves", "approvalsToRaise", "messagesToOwner", "blockedResolutions"],
  properties: {
    summary: { type: "string", description: "One or two sentences on what you did this run" },
    assignments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "kind", "title", "priority", "input"],
        properties: {
          agent: { type: "string", description: "worker slug from the snapshot" },
          kind: { type: "string", description: "playbook kind for that worker" },
          title: { type: "string", description: "three or four words, shown above the worker's head" },
          priority: { type: "integer", minimum: 1, maximum: 9 },
          input: { type: "string", description: "one line of instructions or context for the worker, may be empty" },
        },
      },
    },
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "score", "reason", "decision"],
        properties: {
          taskId: { type: "string" },
          score: { type: "integer", minimum: 1, maximum: 10 },
          reason: { type: "string" },
          decision: { type: "string", enum: ["accept", "reject"] },
        },
      },
    },
    strategyNotes: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["floor", "note"], properties: { floor: { type: "string" }, note: { type: "string" } } },
    },
    ideaActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ideaId", "action", "floor", "reply", "ticketTitle"],
        properties: {
          ideaId: { type: "string" },
          action: { type: "string", enum: ["ticket", "note", "decline"] },
          floor: { type: "string", description: "floor slug or empty" },
          reply: { type: "string", description: "one line to the owner on what you will do" },
          ticketTitle: { type: "string", description: "short title when action is ticket, else empty" },
        },
      },
    },
    budgetMoves: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["from", "to", "usd"], properties: { from: { type: "string" }, to: { type: "string" }, usd: { type: "number", minimum: 0 } } },
    },
    approvalsToRaise: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "summary", "riskNote", "content"],
        properties: {
          type: { type: "string", enum: ["decision", "floor_unlock", "spend_increase", "credential_request"] },
          summary: { type: "string" },
          riskNote: { type: "string" },
          content: { type: "string", description: "the full content or proposal in plain text" },
        },
      },
    },
    messagesToOwner: { type: "array", items: { type: "string" } },
    blockedResolutions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "action", "agent", "input", "reason"],
        properties: {
          taskId: { type: "string" },
          action: { type: "string", enum: ["reassign", "input", "ask_owner"] },
          agent: { type: "string", description: "worker slug when reassigning, else empty" },
          input: { type: "string", description: "the missing input when action is input, else empty" },
          reason: { type: "string" },
        },
      },
    },
  },
};

export interface WardenDecisions {
  summary: string;
  assignments: Array<{ agent: string; kind: string; title: string; priority: number; input: string }>;
  reviews: Array<{ taskId: string; score: number; reason: string; decision: "accept" | "reject" }>;
  strategyNotes: Array<{ floor: string; note: string }>;
  ideaActions: Array<{ ideaId: string; action: "ticket" | "note" | "decline"; floor: string; reply: string; ticketTitle: string }>;
  budgetMoves: Array<{ from: string; to: string; usd: number }>;
  approvalsToRaise: Array<{ type: "decision" | "floor_unlock" | "spend_increase" | "credential_request"; summary: string; riskNote: string; content: string }>;
  messagesToOwner: string[];
  blockedResolutions: Array<{ taskId: string; action: "reassign" | "input" | "ask_owner"; agent: string; input: string; reason: string }>;
}

function arr<T>(v: unknown, map: (x: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) {
    if (item && typeof item === "object") {
      const m = map(item as Record<string, unknown>);
      if (m) out.push(m);
    }
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// Tolerant parse: anything malformed is dropped, never thrown, so one odd field cannot stop a run.
export function parseDecisions(raw: unknown): WardenDecisions | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    summary: str(r.summary) || "Run completed",
    assignments: arr(r.assignments, (x) => (str(x.agent) && str(x.kind) ? { agent: str(x.agent), kind: str(x.kind), title: str(x.title) || str(x.kind), priority: Math.min(9, Math.max(1, Math.round(num(x.priority, 5)))), input: str(x.input) } : null)),
    reviews: arr(r.reviews, (x) => (str(x.taskId) ? { taskId: str(x.taskId), score: Math.min(10, Math.max(1, Math.round(num(x.score, 6)))), reason: str(x.reason), decision: x.decision === "reject" ? "reject" : "accept" } : null)),
    strategyNotes: arr(r.strategyNotes, (x) => (str(x.floor) && str(x.note) ? { floor: str(x.floor), note: str(x.note) } : null)),
    ideaActions: arr(r.ideaActions, (x) => (str(x.ideaId) ? { ideaId: str(x.ideaId), action: x.action === "ticket" ? "ticket" : x.action === "decline" ? "decline" : "note", floor: str(x.floor), reply: str(x.reply), ticketTitle: str(x.ticketTitle) } : null)),
    budgetMoves: arr(r.budgetMoves, (x) => (str(x.from) && str(x.to) && num(x.usd, 0) > 0 ? { from: str(x.from), to: str(x.to), usd: num(x.usd, 0) } : null)),
    approvalsToRaise: arr(r.approvalsToRaise, (x) => {
      const t = str(x.type);
      if (!["decision", "floor_unlock", "spend_increase", "credential_request"].includes(t) || !str(x.summary)) return null;
      return { type: t as "decision", summary: str(x.summary), riskNote: str(x.riskNote), content: str(x.content) };
    }),
    messagesToOwner: Array.isArray(r.messagesToOwner) ? r.messagesToOwner.filter((m): m is string => typeof m === "string" && m.trim().length > 0) : [],
    blockedResolutions: arr(r.blockedResolutions, (x) => (str(x.taskId) ? { taskId: str(x.taskId), action: x.action === "reassign" ? "reassign" : x.action === "input" ? "input" : "ask_owner", agent: str(x.agent), input: str(x.input), reason: str(x.reason) } : null)),
  };
}
