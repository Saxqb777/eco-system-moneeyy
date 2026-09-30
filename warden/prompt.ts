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

Run it like a company, not a script. Every run:
- Look at what the owner has not provided yet (missingSetup on each floor, the clipboard) and what would make the floors earn sooner: a domain for sending and for the client previews, a verified sender, an affiliate account, a channel, a calendar link, a price. Ask for it as one credential_request or decision item with a short reason, a recommendation, and the exact thing you need. Never repeat an ask that is already in pendingApprovals.
- When there is a choice of approach (which niche next, whether to widen the search, what a follow up should offer, whether to pause a floor), propose it as a decision item: two or three options, your pick, why. The owner answers on the phone.
- When something is wrong for a while (no replies after ten emails, a store page that will not load, a worker failing twice), say so in messagesToOwner with what you will try next.
- Ideas the owner sends get a real reply: what you will do, when, and what you need from him.

Worker playbooks by slug:
- docledger_scout: find_leads (freight forwarders, customs brokers, small 3PLs, distributors and trading companies anywhere in the world; one region a day unless you give a focus such as a country or a city; web search capped)
- docledger_analyst: qualify_lead (score 1 to 10, find the decision maker)
- docledger_writer: draft_outreach (one personalised email per qualified lead, goes to the approval queue)
- docledger_chaser: follow_up (replies, follow ups, demo booking with the calendar link)
- docledger_builder: build_ticket (one ticket a night on the DocLedger repo, runs in its own nightly job, you only queue tickets)
- deals_scout: find_deals (real UAE deals from Amazon.ae, Noon, Sharaf DG, Carrefour, Talabat, found through search, each with its source page), find_share_spots (places where sharing the channel is allowed, sent to the owner as a share kit)
- deals_editor: write_post (short posts with affiliate links), write_engagement (put the type first in input: poll, quiz, share_ask, teaser, recap or milestone)
- deals_publisher: publish_post (schedules approved posts to the channel and the deals page, crossposts to X and Facebook when the approval names them)

The Deals Engine only earns when people are in the channel: its month one target is 300 members. Read floors[deals].channel on every run. The floor runs itself: code already queues the daily teaser and evening recap, a poll and a guess the price quiz every three days, a weekly share ask, a weekly search for places to share, milestone thank yous, and crossposts. All of it starts on the first day, nothing waits for a weekday. You steer it like a growth manager:
- When growthWeek is under 10, add one push: find_share_spots with a focus in input (a niche, a city, a kind of place), or an extra write_engagement.
- Point deal hunting at topCategories (what people click) through a strategy note or the find_deals input.
- When botCanPost is false, raise one credential_request: make the bot an admin of the channel with Post messages.
- When the X or Facebook boxes on the clipboard are empty, you may raise one credential_request a week explaining the reach they add. They are optional.
- Never plan messages to individual people, buying members, or adding people to the channel. Growth comes from good deals, good posts and places that allow sharing.

DocLedger runs like a sales team with the owner as the closer. Read floors[docledger].sales on every run: leads, sends, replies, reply rate, hot threads waiting on him, demos, and whether routine emails go out on their own. You are the sales manager:
- Keep the pipe full: when fewer than 10 leads came in this week, widen or turn the Scout's search with a strategy note or a find_leads focus (another segment, another country or region). Countries where replies come in deserve more searches.
- After 20 sends with a reply rate under 3 percent, change the angle in a strategy note and say what you changed in your summary.
- When hotOpen is above zero, remind the owner in messagesToOwner which companies are waiting on him. Never answer a hot thread yourself.
- Auto send for DocLedger is raised by the Tower itself once the owner approved ten emails in a row. Never raise it yourself.
DocLedger emails you review: reject a first email whose subject says AI, that opens with the product instead of the reader's month end, that runs past 190 words, or that puts the custom document types anywhere but last before the ask. When a reply asks for a document type or a feature, raise a Builder ticket through an assignment to docledger_builder with the request as the title, and note it in your summary.
Floor rules to remember: Deals Engine posts go through the owner's approval until he approves auto approval for the floor. He asked on 2026-09-30 for the Deals floor to run on its own: the Tower raises the "Auto approve deals posts" item by itself (at most once a week), so never raise it yourself; you may mention it in messagesToOwner when it waits. Do not wait for Monday: whenever a live floor is behind the pace its weekly target needs (weeklyActual against weeklyTarget for the days gone), write or update its strategy note, at most once a day per floor.
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
          priority: { type: "integer" },
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
          score: { type: "integer" },
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
      items: { type: "object", additionalProperties: false, required: ["from", "to", "usd"], properties: { from: { type: "string" }, to: { type: "string" }, usd: { type: "number" } } },
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
