import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => ts("created_at").defaultNow().notNull();
const updatedAt = () => ts("updated_at").defaultNow().notNull();
const simulated = () => boolean("simulated").default(false).notNull();
const money = (name: string) => numeric(name, { precision: 12, scale: 6 });

// Core

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export const setupItems = pgTable("setup_items", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  howTo: text("how_to").notNull(),
  kind: text("kind").notNull(),
  requiredFor: text("required_for").array().notNull().default(sql`'{}'::text[]`),
  status: text("status").notNull().default("missing"),
  valueEncrypted: text("value_encrypted"),
  hint: text("hint"),
  providedAt: ts("provided_at"),
  sort: integer("sort").notNull().default(0),
});

export const floors = pgTable("floors", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  level: integer("level").notNull(),
  accent: text("accent").notNull(),
  goalMetric: text("goal_metric").notNull(),
  weeklyTarget: numeric("weekly_target", { precision: 12, scale: 2 }).notNull().default("0"),
  targetUnit: text("target_unit").notNull().default(""),
  status: text("status").notNull().default("locked"),
  unlockRule: text("unlock_rule"),
  unlockCondition: jsonb("unlock_condition"),
  strategyNote: text("strategy_note"),
  strategyUpdatedAt: ts("strategy_updated_at"),
  autoApprove: boolean("auto_approve").notNull().default(false),
  autoApproveSince: ts("auto_approve_since"),
  throttledUntil: ts("throttled_until"),
  pausedReason: text("paused_reason"),
  niche: text("niche"),
  nextNiches: jsonb("next_niches").notNull().default(sql`'[]'::jsonb`),
  monthlyGuideUsd: numeric("monthly_guide_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  isBusiness: boolean("is_business").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const agents = pgTable("agents", {
  id: id(),
  slug: text("slug").notNull().unique(),
  floorId: uuid("floor_id").references(() => floors.id),
  name: text("name").notNull(),
  role: text("role").notNull(),
  kind: text("kind").notNull(),
  modelKey: text("model_key").notNull(),
  status: text("status").notNull().default("idle"),
  locationLevel: integer("location_level").notNull().default(0),
  currentTaskId: uuid("current_task_id"),
  sprite: jsonb("sprite").notNull().default(sql`'{}'::jsonb`),
  playbookKey: text("playbook_key").notNull(),
  promptVersion: integer("prompt_version").notNull().default(1),
  tasksDone: integer("tasks_done").notNull().default(0),
  tasksFailed: integer("tasks_failed").notNull().default(0),
  reviewScoreSum: numeric("review_score_sum", { precision: 12, scale: 2 }).notNull().default("0"),
  reviewCount: integer("review_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Work

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    floorId: uuid("floor_id").references(() => floors.id),
    agentId: uuid("agent_id").references(() => agents.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(5),
    input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
    output: jsonb("output"),
    reviewScore: integer("review_score"),
    reviewReason: text("review_reason"),
    feedback: text("feedback"),
    parentTaskId: uuid("parent_task_id"),
    batchId: text("batch_id"),
    batchCustomId: text("batch_custom_id"),
    attempts: integer("attempts").notNull().default(0),
    blockedReason: text("blocked_reason"),
    needsOwner: boolean("needs_owner").notNull().default(false),
    dueAt: ts("due_at"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    simulated: simulated(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_status_idx").on(t.status),
    index("tasks_agent_idx").on(t.agentId, t.createdAt),
    index("tasks_floor_idx").on(t.floorId, t.createdAt),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    taskId: uuid("task_id"),
    agentId: uuid("agent_id"),
    floorId: uuid("floor_id"),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("task_events_task_idx").on(t.taskId, t.id), index("task_events_created_idx").on(t.createdAt)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    summary: text("summary").notNull(),
    content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
    previewUrl: text("preview_url"),
    riskNote: text("risk_note"),
    feedback: text("feedback"),
    taskId: uuid("task_id"),
    agentId: uuid("agent_id"),
    floorId: uuid("floor_id"),
    telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
    decidedAt: ts("decided_at"),
    decidedVia: text("decided_via"),
    executedAt: ts("executed_at"),
    executionResult: jsonb("execution_result"),
    simulated: simulated(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("approvals_status_idx").on(t.status, t.createdAt)],
);

// Money

export const budgetLedger = pgTable(
  "budget_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    amountUsd: money("amount_usd").notNull(),
    floorId: uuid("floor_id"),
    agentId: uuid("agent_id"),
    taskId: uuid("task_id"),
    agentRunId: uuid("agent_run_id"),
    revenueId: uuid("revenue_id"),
    verified: boolean("verified").notNull().default(false),
    note: text("note"),
    simulated: simulated(),
    occurredAt: ts("occurred_at").defaultNow().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_occurred_idx").on(t.occurredAt), index("ledger_floor_idx").on(t.floorId, t.occurredAt)],
);

export const agentRuns = pgTable("agent_runs", {
  id: id(),
  agentId: uuid("agent_id"),
  taskId: uuid("task_id"),
  floorId: uuid("floor_id"),
  model: text("model").notNull(),
  mode: text("mode").notNull().default("sync"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  webSearchCount: integer("web_search_count").notNull().default(0),
  costUsd: money("cost_usd").notNull().default("0"),
  durationMs: integer("duration_ms"),
  stopReason: text("stop_reason"),
  batchId: text("batch_id"),
  customId: text("custom_id"),
  error: text("error"),
  simulated: simulated(),
  startedAt: ts("started_at").defaultNow().notNull(),
  finishedAt: ts("finished_at"),
});

export const revenue = pgTable("revenue", {
  id: id(),
  floorId: uuid("floor_id"),
  source: text("source").notNull(),
  amountUsd: money("amount_usd").notNull(),
  amountOriginal: money("amount_original"),
  currency: text("currency").notNull().default("USD"),
  verified: boolean("verified").notNull().default(false),
  verifiedAt: ts("verified_at"),
  verifiedBy: text("verified_by"),
  evidenceUrl: text("evidence_url"),
  note: text("note"),
  leadId: uuid("lead_id"),
  postId: uuid("post_id"),
  simulated: simulated(),
  occurredAt: ts("occurred_at").defaultNow().notNull(),
  createdAt: createdAt(),
});

export const budgetReviews = pgTable("budget_reviews", {
  id: id(),
  weekStart: date("week_start").notNull(),
  spendUsd: money("spend_usd").notNull(),
  verifiedRevenueUsd: money("verified_revenue_usd").notNull(),
  ratio: numeric("ratio", { precision: 12, scale: 4 }),
  decision: text("decision").notNull(),
  levelBefore: integer("level_before").notNull(),
  levelAfter: integer("level_after").notNull(),
  capBefore: money("cap_before").notNull(),
  capAfter: money("cap_after").notNull(),
  approvalId: uuid("approval_id"),
  consecutiveLowWeeks: integer("consecutive_low_weeks").notNull().default(0),
  createdAt: createdAt(),
});

// Floor 3: DocLedger Sales

export const leads = pgTable(
  "leads",
  {
    id: id(),
    floorId: uuid("floor_id"),
    company: text("company").notNull(),
    website: text("website"),
    segment: text("segment"),
    city: text("city"),
    country: text("country").notNull().default("AE"),
    phone: text("phone"),
    sourceUrl: text("source_url"),
    decisionMaker: jsonb("decision_maker"),
    score: integer("score"),
    scoreReason: text("score_reason"),
    status: text("status").notNull().default("new"),
    nextActionAt: ts("next_action_at"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    foundByTaskId: uuid("found_by_task_id"),
    simulated: simulated(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("leads_status_idx").on(t.status)],
);

export const outreach = pgTable("outreach", {
  id: id(),
  leadId: uuid("lead_id").references(() => leads.id),
  step: integer("step").notNull().default(1),
  channel: text("channel").notNull().default("email"),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  approvalId: uuid("approval_id"),
  status: text("status").notNull().default("draft"),
  resendId: text("resend_id"),
  sentAt: ts("sent_at"),
  replyText: text("reply_text"),
  replyAt: ts("reply_at"),
  simulated: simulated(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tickets = pgTable("tickets", {
  id: id(),
  floorId: uuid("floor_id"),
  source: text("source").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  repo: text("repo"),
  branch: text("branch"),
  prUrl: text("pr_url"),
  previewUrl: text("preview_url"),
  status: text("status").notNull().default("backlog"),
  approvalId: uuid("approval_id"),
  ideaId: uuid("idea_id"),
  builderTaskId: uuid("builder_task_id"),
  costUsd: money("cost_usd").notNull().default("0"),
  failureReason: text("failure_reason"),
  simulated: simulated(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Floor 2: Deals Engine

export const deals = pgTable("deals", {
  id: id(),
  floorId: uuid("floor_id"),
  store: text("store").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  affiliateUrl: text("affiliate_url"),
  price: numeric("price", { precision: 12, scale: 2 }),
  wasPrice: numeric("was_price", { precision: 12, scale: 2 }),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }),
  currency: text("currency").notNull().default("AED"),
  category: text("category"),
  imageUrl: text("image_url"),
  foundByTaskId: uuid("found_by_task_id"),
  status: text("status").notNull().default("found"),
  expiresAt: ts("expires_at"),
  dedupeKey: text("dedupe_key").notNull().unique(),
  simulated: simulated(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const posts = pgTable("posts", {
  id: id(),
  floorId: uuid("floor_id"),
  kind: text("kind").notNull().default("deal"),
  dealIds: uuid("deal_ids").array().notNull().default(sql`'{}'::uuid[]`),
  body: text("body").notNull(),
  channel: text("channel").notNull().default("telegram_channel"),
  approvalId: uuid("approval_id"),
  status: text("status").notNull().default("draft"),
  scheduledAt: ts("scheduled_at"),
  postedAt: ts("posted_at"),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  shortCode: text("short_code").unique(),
  clicks: integer("clicks").notNull().default(0),
  simulated: simulated(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const clicks = pgTable("clicks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  shortCode: text("short_code").notNull(),
  postId: uuid("post_id"),
  dealId: uuid("deal_id"),
  ts: ts("ts").defaultNow().notNull(),
  referrer: text("referrer"),
  country: text("country"),
  uaHash: text("ua_hash"),
});

// Warden and messaging

export const ideas = pgTable("ideas", {
  id: id(),
  text: text("text").notNull(),
  source: text("source").notNull().default("ui"),
  status: text("status").notNull().default("new"),
  floorId: uuid("floor_id"),
  ticketId: uuid("ticket_id"),
  wardenReply: text("warden_reply"),
  telegramMessageId: bigint("telegram_message_id", { mode: "number" }),
  handledAt: ts("handled_at"),
  createdAt: createdAt(),
});

export const wardenRuns = pgTable("warden_runs", {
  id: id(),
  mode: text("mode").notNull(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull().default("submitted"),
  snapshot: jsonb("snapshot"),
  decisions: jsonb("decisions"),
  summary: text("summary"),
  costUsd: money("cost_usd").notNull().default("0"),
  agentRunId: uuid("agent_run_id"),
  batchId: text("batch_id"),
  startedAt: ts("started_at").defaultNow().notNull(),
  finishedAt: ts("finished_at"),
  simulated: simulated(),
});

export const batches = pgTable("batches", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("submitted"),
  requestCount: integer("request_count").notNull().default(0),
  submittedAt: ts("submitted_at").defaultNow().notNull(),
  endedAt: ts("ended_at"),
  collectedAt: ts("collected_at"),
  error: text("error"),
});

export const messagesOut = pgTable(
  "messages_out",
  {
    id: id(),
    channel: text("channel").notNull().default("telegram"),
    chatId: text("chat_id"),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    inlineKeyboard: jsonb("inline_keyboard"),
    relatedType: text("related_type"),
    relatedId: uuid("related_id"),
    status: text("status").notNull().default("queued"),
    sendAfter: ts("send_after").defaultNow().notNull(),
    sentAt: ts("sent_at"),
    providerMessageId: bigint("provider_message_id", { mode: "number" }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_out_status_idx").on(t.status, t.sendAfter)],
);

export const telegramUpdates = pgTable("telegram_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  receivedAt: ts("received_at").defaultNow().notNull(),
  payload: jsonb("payload").notNull(),
});

// Heartbeat log, one row per tick so the status page and Warden can see the pulse.

export const ticks = pgTable("ticks", {
  id: id(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull().default("running"),
  steps: jsonb("steps").notNull().default(sql`'{}'::jsonb`),
  error: text("error"),
  startedAt: ts("started_at").defaultNow().notNull(),
  finishedAt: ts("finished_at"),
});
