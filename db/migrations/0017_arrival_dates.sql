ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "arrival_date_start" date;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "arrival_date_end" date;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_arrival_idx" ON "leads" USING btree ("arrival_date_start","arrival_date_end");
