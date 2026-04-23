CREATE TYPE "public"."pending_email_kind" AS ENUM('new_import', 'update_batch');--> statement-breakpoint
CREATE TYPE "public"."pending_email_status" AS ENUM('pending', 'processing', 'done', 'failed', 'merged', 'dismissed');--> statement-breakpoint
CREATE TABLE "pending_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "pending_email_kind" NOT NULL,
	"email_address" text,
	"lead_id" uuid,
	"status" "pending_email_status" DEFAULT 'pending' NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extraction" jsonb,
	"match_candidate_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"first_message_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"resolved_lead_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "alias_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_emails" ADD CONSTRAINT "pending_emails_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_emails" ADD CONSTRAINT "pending_emails_resolved_lead_id_leads_id_fk" FOREIGN KEY ("resolved_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_emails_status_idx" ON "pending_emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_emails_created_idx" ON "pending_emails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pending_emails_lead_idx" ON "pending_emails" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "pending_emails_kind_idx" ON "pending_emails" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "interactions_message_id_idx" ON "interactions" USING btree ("message_id");