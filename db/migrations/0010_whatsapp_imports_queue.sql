CREATE TYPE "public"."pending_whatsapp_import_status" AS ENUM('pending', 'processing', 'done', 'failed', 'merged', 'dismissed');--> statement-breakpoint
CREATE TABLE "pending_whatsapp_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_hash" text NOT NULL,
	"original_filename" text NOT NULL,
	"file_bytes" "bytea" NOT NULL,
	"is_zip" boolean NOT NULL,
	"language" "language",
	"status" "pending_whatsapp_import_status" DEFAULT 'pending' NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error" text,
	"inferred_lead_name" text,
	"inferred_phones" text[] DEFAULT '{}'::text[] NOT NULL,
	"rendered_chat" text,
	"extraction" jsonb,
	"audio_stats" jsonb,
	"message_count" integer,
	"first_message_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"match_candidate_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"resolved_lead_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_whatsapp_imports" ADD CONSTRAINT "pending_whatsapp_imports_resolved_lead_id_leads_id_fk" FOREIGN KEY ("resolved_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_wa_imports_hash_idx" ON "pending_whatsapp_imports" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "pending_wa_imports_status_idx" ON "pending_whatsapp_imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_wa_imports_created_idx" ON "pending_whatsapp_imports" USING btree ("created_at");