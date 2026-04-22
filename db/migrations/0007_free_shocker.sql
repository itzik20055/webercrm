ALTER TABLE "leads" ADD COLUMN "last_reprocess_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_reprocessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "pending_followup_suggestion" jsonb;