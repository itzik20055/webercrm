ALTER TABLE "voice_examples" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_examples" ADD COLUMN "score" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_examples" ADD COLUMN "scenario_tag" text;--> statement-breakpoint
ALTER TABLE "voice_examples" ADD COLUMN "outcome_signals" jsonb;--> statement-breakpoint
ALTER TABLE "voice_examples" ADD COLUMN "message_hash" text;--> statement-breakpoint
CREATE INDEX "voice_examples_score_idx" ON "voice_examples" USING btree ("score");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_examples_message_hash_idx" ON "voice_examples" USING btree ("message_hash") WHERE "voice_examples"."message_hash" is not null;