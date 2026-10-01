CREATE TABLE "trading_desks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"market" text NOT NULL,
	"style" text NOT NULL,
	"start_usd" numeric(12, 6) NOT NULL,
	"cash_usd" numeric(12, 6) NOT NULL,
	"equity_usd" numeric(12, 6) NOT NULL,
	"peak_usd" numeric(12, 6) NOT NULL,
	"day_start_usd" numeric(12, 6) NOT NULL,
	"day_key" text,
	"fees_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"status_reason" text,
	"benched_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_desks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "trading_equity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"desk_id" uuid NOT NULL,
	"equity_usd" numeric(12, 6) NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_news" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"headline" text NOT NULL,
	"summary" text,
	"url" text,
	"source" text,
	"symbols" text[] DEFAULT '{}'::text[] NOT NULL,
	"sentiment" text,
	"impact" integer,
	"published_at" timestamp with time zone NOT NULL,
	"tagged_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_news_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "trading_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"desk_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"market" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"qty" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"stop_price" numeric(20, 8),
	"target_price" numeric(20, 8),
	"initial_stop" numeric(20, 8),
	"high_water" numeric(20, 8),
	"cost_usd" numeric(12, 6) NOT NULL,
	"entry_fee_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"exit_price" numeric(20, 8),
	"exit_fee_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"exit_reason" text,
	"proceeds_usd" numeric(12, 6),
	"pnl_usd" numeric(12, 6),
	"pnl_pct" numeric(12, 4),
	"settles_at" timestamp with time zone,
	"thesis" text,
	"signal_id" uuid,
	"meeting" jsonb,
	"lesson" text,
	"reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"market" text NOT NULL,
	"kind" text NOT NULL,
	"score" integer NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"desk_slug" text,
	"meeting" jsonb,
	"decided_at" timestamp with time zone,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trading_equity_desk_idx" ON "trading_equity" USING btree ("desk_id","at");--> statement-breakpoint
CREATE INDEX "trading_news_published_idx" ON "trading_news" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "trading_positions_desk_idx" ON "trading_positions" USING btree ("desk_id","status");--> statement-breakpoint
CREATE INDEX "trading_positions_closed_idx" ON "trading_positions" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "trading_signals_created_idx" ON "trading_signals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trading_signals_symbol_idx" ON "trading_signals" USING btree ("symbol","created_at");