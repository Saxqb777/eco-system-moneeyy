ALTER TABLE "leads" ADD COLUMN "demo_visits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "demo_scans" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "demo_reads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "demo_visited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "reply_email_id" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "bounce_reason" text;