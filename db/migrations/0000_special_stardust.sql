CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"task_id" uuid,
	"floor_id" uuid,
	"model" text NOT NULL,
	"mode" text DEFAULT 'sync' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"web_search_count" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"stop_reason" text,
	"batch_id" text,
	"custom_id" text,
	"error" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"floor_id" uuid,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"model_key" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"location_level" integer DEFAULT 0 NOT NULL,
	"current_task_id" uuid,
	"sprite" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"playbook_key" text NOT NULL,
	"prompt_version" integer DEFAULT 1 NOT NULL,
	"tasks_done" integer DEFAULT 0 NOT NULL,
	"tasks_failed" integer DEFAULT 0 NOT NULL,
	"review_score_sum" numeric(12, 2) DEFAULT '0' NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview_url" text,
	"risk_note" text,
	"feedback" text,
	"task_id" uuid,
	"agent_id" uuid,
	"floor_id" uuid,
	"telegram_message_id" bigint,
	"decided_at" timestamp with time zone,
	"decided_via" text,
	"executed_at" timestamp with time zone,
	"execution_result" jsonb,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "budget_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount_usd" numeric(12, 6) NOT NULL,
	"floor_id" uuid,
	"agent_id" uuid,
	"task_id" uuid,
	"agent_run_id" uuid,
	"revenue_id" uuid,
	"verified" boolean DEFAULT false NOT NULL,
	"note" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"spend_usd" numeric(12, 6) NOT NULL,
	"verified_revenue_usd" numeric(12, 6) NOT NULL,
	"ratio" numeric(12, 4),
	"decision" text NOT NULL,
	"level_before" integer NOT NULL,
	"level_after" integer NOT NULL,
	"cap_before" numeric(12, 6) NOT NULL,
	"cap_after" numeric(12, 6) NOT NULL,
	"approval_id" uuid,
	"consecutive_low_weeks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clicks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"short_code" text NOT NULL,
	"post_id" uuid,
	"deal_id" uuid,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"referrer" text,
	"country" text,
	"ua_hash" text
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid,
	"store" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"affiliate_url" text,
	"price" numeric(12, 2),
	"was_price" numeric(12, 2),
	"discount_pct" numeric(5, 2),
	"currency" text DEFAULT 'AED' NOT NULL,
	"category" text,
	"image_url" text,
	"found_by_task_id" uuid,
	"status" text DEFAULT 'found' NOT NULL,
	"expires_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"accent" text NOT NULL,
	"goal_metric" text NOT NULL,
	"weekly_target" numeric(12, 2) DEFAULT '0' NOT NULL,
	"target_unit" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'locked' NOT NULL,
	"unlock_rule" text,
	"unlock_condition" jsonb,
	"strategy_note" text,
	"strategy_updated_at" timestamp with time zone,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"auto_approve_since" timestamp with time zone,
	"throttled_until" timestamp with time zone,
	"paused_reason" text,
	"niche" text,
	"next_niches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"monthly_guide_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_business" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "floors_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"source" text DEFAULT 'ui' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"floor_id" uuid,
	"ticket_id" uuid,
	"warden_reply" text,
	"telegram_message_id" bigint,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid,
	"company" text NOT NULL,
	"website" text,
	"segment" text,
	"city" text,
	"country" text DEFAULT 'AE' NOT NULL,
	"phone" text,
	"source_url" text,
	"decision_maker" jsonb,
	"score" integer,
	"score_reason" text,
	"status" text DEFAULT 'new' NOT NULL,
	"next_action_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"found_by_task_id" uuid,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "messages_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text DEFAULT 'telegram' NOT NULL,
	"chat_id" text,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"inline_keyboard" jsonb,
	"related_type" text,
	"related_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"provider_message_id" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"step" integer DEFAULT 1 NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"approval_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"resend_id" text,
	"sent_at" timestamp with time zone,
	"reply_text" text,
	"reply_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid,
	"kind" text DEFAULT 'deal' NOT NULL,
	"deal_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"body" text NOT NULL,
	"channel" text DEFAULT 'telegram_channel' NOT NULL,
	"approval_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"telegram_message_id" bigint,
	"short_code" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
CREATE TABLE "revenue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid,
	"source" text NOT NULL,
	"amount_usd" numeric(12, 6) NOT NULL,
	"amount_original" numeric(12, 6),
	"currency" text DEFAULT 'USD' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"evidence_url" text,
	"note" text,
	"lead_id" uuid,
	"post_id" uuid,
	"simulated" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_items" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"how_to" text NOT NULL,
	"kind" text NOT NULL,
	"required_for" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'missing' NOT NULL,
	"value_encrypted" text,
	"hint" text,
	"provided_at" timestamp with time zone,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" uuid,
	"agent_id" uuid,
	"floor_id" uuid,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid,
	"agent_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"review_score" integer,
	"review_reason" text,
	"feedback" text,
	"parent_task_id" uuid,
	"batch_id" text,
	"batch_custom_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"blocked_reason" text,
	"needs_owner" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"repo" text,
	"branch" text,
	"pr_url" text,
	"preview_url" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"approval_id" uuid,
	"idea_id" uuid,
	"builder_task_id" uuid,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"failure_reason" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "warden_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"snapshot" jsonb,
	"decisions" jsonb,
	"summary" text,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"agent_run_id" uuid,
	"batch_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ledger_occurred_idx" ON "budget_ledger" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_floor_idx" ON "budget_ledger" USING btree ("floor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_out_status_idx" ON "messages_out" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("task_id","id");--> statement-breakpoint
CREATE INDEX "task_events_created_idx" ON "task_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_agent_idx" ON "tasks" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_floor_idx" ON "tasks" USING btree ("floor_id","created_at");