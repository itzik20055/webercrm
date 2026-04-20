/**
 * Backfill embeddings for existing product_kb and voice_examples rows that
 * don't have one yet. Idempotent — safe to re-run after adding new entries.
 *
 * Run with: npx tsx scripts/backfill-embeddings.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { isNull, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { embedBatch } from "../lib/embeddings";

const BATCH_SIZE = 16;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (!process.env.AI_GATEWAY_API_KEY)
    throw new Error("AI_GATEWAY_API_KEY missing");

  const sql = neon(url);
  const db = drizzle(sql, { schema, casing: "snake_case" });

  // --- product_kb ---
  const kbRows = await db
    .select({
      id: schema.productKb.id,
      title: schema.productKb.title,
      content: schema.productKb.content,
      category: schema.productKb.category,
    })
    .from(schema.productKb)
    .where(isNull(schema.productKb.embedding));

  console.log(`product_kb: ${kbRows.length} rows need embeddings`);

  for (let i = 0; i < kbRows.length; i += BATCH_SIZE) {
    const slice = kbRows.slice(i, i + BATCH_SIZE);
    const inputs = slice.map((r) => `[${r.category}] ${r.title}\n\n${r.content}`);
    const vecs = await embedBatch(inputs);
    const now = new Date();
    for (let j = 0; j < slice.length; j++) {
      await db
        .update(schema.productKb)
        .set({ embedding: vecs[j], embeddedAt: now })
        .where(eq(schema.productKb.id, slice[j].id));
    }
    console.log(`  embedded ${i + slice.length}/${kbRows.length}`);
  }

  // --- voice_examples ---
  const veRows = await db
    .select({
      id: schema.voiceExamples.id,
      finalText: schema.voiceExamples.finalText,
      scenario: schema.voiceExamples.scenario,
    })
    .from(schema.voiceExamples)
    .where(isNull(schema.voiceExamples.embedding));

  console.log(`voice_examples: ${veRows.length} rows need embeddings`);

  for (let i = 0; i < veRows.length; i += BATCH_SIZE) {
    const slice = veRows.slice(i, i + BATCH_SIZE);
    const inputs = slice.map((r) => `[${r.scenario}] ${r.finalText}`);
    const vecs = await embedBatch(inputs);
    const now = new Date();
    for (let j = 0; j < slice.length; j++) {
      await db
        .update(schema.voiceExamples)
        .set({ embedding: vecs[j], embeddedAt: now })
        .where(eq(schema.voiceExamples.id, slice[j].id));
    }
    console.log(`  embedded ${i + slice.length}/${veRows.length}`);
  }

  console.log("\n✓ done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
