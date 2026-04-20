CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "product_kb" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "product_kb" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_examples" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "voice_examples" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "product_kb_embedding_idx" ON "product_kb" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "voice_examples_embedding_idx" ON "voice_examples" USING hnsw ("embedding" vector_cosine_ops);