CREATE TYPE "public"."audience" AS ENUM('israeli_haredi', 'american_haredi', 'european_haredi');--> statement-breakpoint
CREATE TYPE "public"."budget_signal" AS ENUM('low', 'mid', 'high');--> statement-breakpoint
CREATE TYPE "public"."building" AS ENUM('a', 'b', 'any');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('call', 'whatsapp', 'email', 'referral', 'other');--> statement-breakpoint
CREATE TYPE "public"."interaction_direction" AS ENUM('in', 'out', 'internal');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('call_in', 'call_out', 'whatsapp', 'email', 'sms', 'note');--> statement-breakpoint
CREATE TYPE "public"."kb_category" AS ENUM('hotel', 'rooms', 'food', 'activities', 'prices', 'logistics', 'faq');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('he', 'en', 'yi');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('hot', 'warm', 'cold');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'interested', 'quoted', 'closing', 'booked', 'lost');--> statement-breakpoint
CREATE TABLE "ai_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" text NOT NULL,
	"model" text,
	"input_anonymized" text NOT NULL,
	"output" text,
	"placeholder_map" jsonb,
	"lead_id" uuid,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reason" text,
	"reminder_sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" "interaction_type" NOT NULL,
	"direction" "interaction_direction" DEFAULT 'in' NOT NULL,
	"content" text NOT NULL,
	"ai_summary" text,
	"ai_tags" text[],
	"duration_min" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"language" "language" DEFAULT 'he' NOT NULL,
	"audience" "audience" DEFAULT 'israeli_haredi' NOT NULL,
	"channel_first" "channel" DEFAULT 'whatsapp' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"lost_reason" text,
	"source" text,
	"num_adults" integer,
	"num_children" integer,
	"ages_children" text,
	"dates_interest" text,
	"room_type_interest" text,
	"building_pref" "building",
	"budget_signal" "budget_signal",
	"interest_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"what_spoke_to_them" text,
	"objections" text,
	"next_followup_at" timestamp with time zone,
	"followup_completed_at" timestamp with time zone,
	"priority" "priority" DEFAULT 'warm' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_kb" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "kb_category" NOT NULL,
	"language" "language" DEFAULT 'he' NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "response_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" "language" DEFAULT 'he' NOT NULL,
	"scenario" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_audit_log" ADD CONSTRAINT "ai_audit_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_audit_created_idx" ON "ai_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "followups_due_idx" ON "followups" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "followups_lead_idx" ON "followups" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "followups_completed_idx" ON "followups" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "interactions_lead_idx" ON "interactions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "interactions_occurred_idx" ON "interactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_next_followup_idx" ON "leads" USING btree ("next_followup_at");--> statement-breakpoint
CREATE INDEX "leads_priority_idx" ON "leads" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_at");