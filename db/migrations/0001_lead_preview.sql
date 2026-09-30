ALTER TABLE "leads" ADD COLUMN "preview" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "preview_code" text;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_preview_code_unique" UNIQUE("preview_code");