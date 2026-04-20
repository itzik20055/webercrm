ALTER TABLE "leads" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "pending_extraction" jsonb;--> statement-breakpoint
CREATE INDEX "leads_needs_review_idx" ON "leads" USING btree ("needs_review");