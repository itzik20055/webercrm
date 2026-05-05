/**
 * One-off cleanup for voice_examples rows that were saved with leftover
 * speaker prefixes ("מוכר:", "לקוח:") from phone-call transcripts. Strips the
 * prefix from finalText, recomputes messageHash so future cron runs still
 * dedupe correctly, and NULLs the embedding so backfill-embeddings.ts can
 * re-embed in the canonical [scenario] format.
 *
 * Idempotent — safe to re-run.
 *
 * Run with: npx tsx scripts/strip-speaker-prefixes.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, isNotNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { stripSpeakerPrefix } from "../lib/learning";

function rehash(leadId: string | null, message: string): string {
  const normalized = stripSpeakerPrefix(message).replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${leadId ?? ""}::${normalized}`)
    .digest("hex");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const sql = neon(url);
  const db = drizzle(sql, { schema, casing: "snake_case" });

  // Pull every auto_outcome row (manual rows weren't extracted from phone
  // transcripts so they never carried speaker prefixes).
  const rows = await db
    .select({
      id: schema.voiceExamples.id,
      leadId: schema.voiceExamples.leadId,
      finalText: schema.voiceExamples.finalText,
      messageHash: schema.voiceExamples.messageHash,
    })
    .from(schema.voiceExamples)
    .where(eq(schema.voiceExamples.source, "auto_outcome"));

  console.log(`auto_outcome rows: ${rows.length}`);

  let stripped = 0;
  let alreadyClean = 0;
  let nulledEmbedding = 0;

  for (const r of rows) {
    const cleaned = stripSpeakerPrefix(r.finalText);
    const changed = cleaned !== r.finalText;
    const newHash = rehash(r.leadId, r.finalText);

    if (changed) {
      // Detect collisions: another row may already exist with the new hash
      // (could happen if the cron previously saved both prefixed and clean
      // copies of the same message). When that happens, drop the duplicate
      // instead of failing on the unique index.
      const existing = await db
        .select({ id: schema.voiceExamples.id })
        .from(schema.voiceExamples)
        .where(
          and(
            eq(schema.voiceExamples.messageHash, newHash),
            isNotNull(schema.voiceExamples.messageHash)
          )
        );
      const collidesWithOther = existing.some((e) => e.id !== r.id);

      if (collidesWithOther) {
        await db
          .delete(schema.voiceExamples)
          .where(eq(schema.voiceExamples.id, r.id));
        console.log(`  - dropped duplicate ${r.id} (clean form already exists)`);
        continue;
      }

      await db
        .update(schema.voiceExamples)
        .set({
          finalText: cleaned,
          messageHash: newHash,
          embedding: null,
          embeddedAt: null,
        })
        .where(eq(schema.voiceExamples.id, r.id));
      stripped += 1;
      nulledEmbedding += 1;
    } else if (r.messageHash !== newHash) {
      // Hash format drifted (older rows hashed without the strip-normalization
      // step) — refresh the hash but keep the embedding as-is since the text
      // is already in canonical form.
      await db
        .update(schema.voiceExamples)
        .set({ messageHash: newHash })
        .where(eq(schema.voiceExamples.id, r.id));
      alreadyClean += 1;
    } else {
      alreadyClean += 1;
    }
  }

  console.log("\n--- summary ---");
  console.log(`stripped + nulled embedding: ${stripped}`);
  console.log(`already clean (no change):   ${alreadyClean}`);
  console.log(`embedding nulled total:      ${nulledEmbedding}`);
  console.log("\nnext step: run `npx tsx scripts/backfill-embeddings.ts` to re-embed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
