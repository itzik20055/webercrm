/**
 * One-shot: NULLs embeddings on every voice_examples row saved by the
 * learning cron (`source = 'auto_outcome'`). The cron used to embed the raw
 * message text without the canonical `[scenario]` prefix; this lets
 * backfill-embeddings.ts re-embed them through the unified
 * `voiceEmbeddingInput()` helper so all sources occupy the same cosine space.
 *
 * Re-running is harmless — idempotent against rows already null.
 *
 * Run with: npx tsx scripts/null-auto-outcome-embeddings.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, isNotNull } from "drizzle-orm";
import * as schema from "../db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const sql = neon(url);
  const db = drizzle(sql, { schema, casing: "snake_case" });

  const before = await db
    .select({ id: schema.voiceExamples.id })
    .from(schema.voiceExamples)
    .where(
      and(
        eq(schema.voiceExamples.source, "auto_outcome"),
        isNotNull(schema.voiceExamples.embedding)
      )
    );

  console.log(`auto_outcome rows with embedding: ${before.length}`);
  if (before.length === 0) {
    console.log("nothing to null — done.");
    return;
  }

  await db
    .update(schema.voiceExamples)
    .set({ embedding: null, embeddedAt: null })
    .where(
      and(
        eq(schema.voiceExamples.source, "auto_outcome"),
        isNotNull(schema.voiceExamples.embedding)
      )
    );

  console.log(`✓ nulled ${before.length} embeddings`);
  console.log("\nnext step: run `npx tsx scripts/backfill-embeddings.ts` to re-embed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
