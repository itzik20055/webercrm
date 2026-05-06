CREATE TYPE "public"."archive_import_kind" AS ENUM('whatsapp', 'phone');--> statement-breakpoint
CREATE TYPE "public"."archive_import_status" AS ENUM('pending', 'counting', 'ready', 'processing', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."archive_outcome" AS ENUM('booked', 'lost', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."archive_source" AS ENUM('whatsapp_archive', 'phone_archive');--> statement-breakpoint
CREATE TABLE "archive_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "archive_import_kind" NOT NULL,
	"status" "archive_import_status" DEFAULT 'pending' NOT NULL,
	"date_from" timestamp with time zone,
	"date_to" timestamp with time zone,
	"item_count" integer,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "archive_source" NOT NULL,
	"phone_hash" text,
	"transcript" text NOT NULL,
	"audience" "audience" NOT NULL,
	"language" "language" NOT NULL,
	"archetype" jsonb NOT NULL,
	"outcome" "archive_outcome" DEFAULT 'unknown' NOT NULL,
	"outcome_confidence" real DEFAULT 1 NOT NULL,
	"embedding" vector(1536),
	"embedded_at" timestamp with time zone,
	"conversation_started_at" timestamp with time zone,
	"conversation_ended_at" timestamp with time zone,
	"interaction_count" integer,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "archive_imports_status_idx" ON "archive_imports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "archive_imports_created_idx" ON "archive_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversation_archive_audience_idx" ON "conversation_archive" USING btree ("audience","language");--> statement-breakpoint
CREATE INDEX "conversation_archive_outcome_idx" ON "conversation_archive" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "conversation_archive_phone_hash_idx" ON "conversation_archive" USING btree ("phone_hash");--> statement-breakpoint
CREATE INDEX "conversation_archive_batch_idx" ON "conversation_archive" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "conversation_archive_embedding_idx" ON "conversation_archive" USING hnsw ("embedding" vector_cosine_ops);