CREATE TYPE "public"."pending_call_recording_status" AS ENUM('pending', 'approved', 'merged', 'dismissed');--> statement-breakpoint
CREATE TABLE "pending_call_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_phone" text NOT NULL,
	"direction" "interaction_direction" NOT NULL,
	"mail_subject" text NOT NULL,
	"call_at" timestamp with time zone NOT NULL,
	"transcript" text,
	"transcription_error" text,
	"extraction" jsonb,
	"match_candidate_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "pending_call_recording_status" DEFAULT 'pending' NOT NULL,
	"resolved_lead_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_call_recordings" ADD CONSTRAINT "pending_call_recordings_resolved_lead_id_leads_id_fk" FOREIGN KEY ("resolved_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_call_recordings_status_idx" ON "pending_call_recordings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_call_recordings_created_idx" ON "pending_call_recordings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pending_call_recordings_phone_idx" ON "pending_call_recordings" USING btree ("customer_phone");