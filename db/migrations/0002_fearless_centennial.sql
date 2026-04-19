CREATE TYPE "public"."draft_scenario" AS ENUM('first_reply', 'send_price', 'price_objection', 'silent_followup', 'date_confirmation', 'closing_request', 'general');--> statement-breakpoint
CREATE TABLE "voice_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"scenario" "draft_scenario" NOT NULL,
	"language" "language" NOT NULL,
	"audience" "audience" NOT NULL,
	"ai_draft" text NOT NULL,
	"final_text" text NOT NULL,
	"context_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_examples" ADD CONSTRAINT "voice_examples_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_examples_match_idx" ON "voice_examples" USING btree ("audience","scenario","language");--> statement-breakpoint
CREATE INDEX "voice_examples_created_idx" ON "voice_examples" USING btree ("created_at");