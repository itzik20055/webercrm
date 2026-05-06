import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

/**
 * Last-resort manual resume tool. Picks up the latest stuck phone-archive
 * batch (or one passed by id), clears its heartbeat so the cron sees it as
 * available, and prints what's left to do.
 *
 *   npx tsx scripts/resume-batch.ts             # latest stuck batch
 *   npx tsx scripts/resume-batch.ts <batch-id>  # specific batch
 *
 * After running this, the next /api/cron/archive-resume tick (within 2 min)
 * will pick up the batch and continue. Or call /api/archive/phone/resume
 * directly with the CRON_SECRET if you want immediate work.
 */
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const explicitId = process.argv[2];

  let batch: {
    id: string;
    status: string;
    processed_count: number;
    success_count: number;
    failure_count: number;
    item_count: number | null;
    resume_count: number;
    last_heartbeat_at: any;
  } | null = null;

  if (explicitId) {
    const rows = (await sql`
      SELECT id, status, processed_count, success_count, failure_count,
             item_count, resume_count, last_heartbeat_at
      FROM archive_imports
      WHERE id = ${explicitId}
    `) as any[];
    batch = rows[0] ?? null;
  } else {
    const rows = (await sql`
      SELECT id, status, processed_count, success_count, failure_count,
             item_count, resume_count, last_heartbeat_at
      FROM archive_imports
      WHERE kind = 'phone' AND status = 'processing'
      ORDER BY created_at DESC
      LIMIT 1
    `) as any[];
    batch = rows[0] ?? null;
  }

  if (!batch) {
    console.log("(no matching batch)");
    return;
  }

  console.log("=== batch ===");
  console.log(`  id           ${batch.id}`);
  console.log(`  status       ${batch.status}`);
  console.log(`  processed    ${batch.processed_count} / ${batch.item_count ?? "?"}`);
  console.log(`  resume_count ${batch.resume_count}`);
  console.log(`  heartbeat    ${batch.last_heartbeat_at ? new Date(batch.last_heartbeat_at).toLocaleString("he-IL") : "(none)"}`);

  if (batch.status !== "processing") {
    console.log("\nbatch is not in processing state — nothing to resume.");
    return;
  }

  console.log("\nclearing heartbeat so the cron sees it as available…");
  await sql`
    UPDATE archive_imports SET last_heartbeat_at = NULL WHERE id = ${batch.id}
  `;
  console.log("done. The /api/cron/archive-resume cron (every 2 min) will now pick this up.");
  console.log("\nIf you don't want to wait, call the production endpoint with curl:");
  console.log(`  curl -X POST https://<your-domain>/api/archive/phone/resume \\`);
  console.log(`    -H "authorization: Bearer $CRON_SECRET" \\`);
  console.log(`    -H "content-type: application/json" \\`);
  console.log(`    -d '{"batchId":"${batch.id}"}'`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
