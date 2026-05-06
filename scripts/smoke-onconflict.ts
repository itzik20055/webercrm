import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";
import { db, conversationArchive, archiveImports } from "../db";

async function main() {
  // Create a throwaway batch
  const [batch] = await db
    .insert(archiveImports)
    .values({ kind: "phone", status: "pending" })
    .returning({ id: archiveImports.id });
  console.log("created throwaway batch", batch.id);

  const phoneHash = "smoke-test-" + Date.now().toString();
  const baseValues = {
    source: "phone_archive" as const,
    phoneHash,
    transcript: "smoke",
    audience: "israeli_haredi" as const,
    language: "he" as const,
    archetype: { test: true },
    outcome: "unknown" as const,
    outcomeConfidence: 0.5,
    importBatchId: batch.id,
  };

  const first = await db
    .insert(conversationArchive)
    .values(baseValues)
    .onConflictDoNothing({
      target: [conversationArchive.importBatchId, conversationArchive.phoneHash],
      where: sql`${conversationArchive.importBatchId} is not null and ${conversationArchive.phoneHash} is not null`,
    })
    .returning({ id: conversationArchive.id });
  console.log("first insert:", first);

  const second = await db
    .insert(conversationArchive)
    .values(baseValues)
    .onConflictDoNothing({
      target: [conversationArchive.importBatchId, conversationArchive.phoneHash],
      where: sql`${conversationArchive.importBatchId} is not null and ${conversationArchive.phoneHash} is not null`,
    })
    .returning({ id: conversationArchive.id });
  console.log("second insert (should be empty):", second);

  // cleanup
  await db.execute(sql`DELETE FROM conversation_archive WHERE import_batch_id = ${batch.id}`);
  await db.execute(sql`DELETE FROM archive_imports WHERE id = ${batch.id}`);
  console.log("✓ cleanup done");

  if (first.length === 1 && second.length === 0) {
    console.log("\n✓ ON CONFLICT works: first inserted, second was a no-op");
  } else {
    console.log("\n❌ unexpected — first.length=" + first.length + " second.length=" + second.length);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
