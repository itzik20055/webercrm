import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const [batch] = (await sql`
    SELECT id, status, processed_count, success_count, failure_count,
           item_count, resume_count, created_at, started_at, finished_at, error
    FROM archive_imports
    WHERE kind = 'phone'
    ORDER BY created_at DESC
    LIMIT 1
  `) as Array<{
    id: string;
    status: string;
    processed_count: number;
    success_count: number;
    failure_count: number;
    item_count: number | null;
    resume_count: number;
    created_at: any;
    started_at: any;
    finished_at: any;
    error: string | null;
  }>;

  if (!batch) {
    console.log("(no phone batches)");
    return;
  }

  const now = Date.now();
  const startedMs = new Date(batch.started_at ?? batch.created_at).getTime();
  const elapsedMin = ((now - startedMs) / 60000).toFixed(1);

  console.log("=== latest phone batch ===");
  console.log(`  id           ${batch.id}`);
  console.log(`  status       ${batch.status}`);
  console.log(`  processed    ${batch.processed_count} / ${batch.item_count ?? "?"} items`);
  console.log(`  success      ${batch.success_count}`);
  console.log(`  failure      ${batch.failure_count}`);
  console.log(`  resume_count ${batch.resume_count}`);
  console.log(`  started      ${new Date(batch.started_at ?? batch.created_at).toLocaleString("he-IL")}`);
  console.log(`  finished     ${batch.finished_at ? new Date(batch.finished_at).toLocaleString("he-IL") : "—"}`);
  console.log(`  elapsed      ${elapsedMin} min`);
  if (batch.error) console.log(`  error        ${batch.error}`);

  // Check ai_audit_log for recent activity for this batch
  const recentAi = (await sql`
    SELECT created_at, model, duration_ms, error
    FROM ai_audit_log
    WHERE created_at > NOW() - INTERVAL '15 minutes'
    ORDER BY created_at DESC
    LIMIT 10
  `) as Array<{ created_at: any; model: string; duration_ms: number; error: string | null }>;

  console.log("\n=== ai_audit_log — last 15 minutes ===");
  if (recentAi.length === 0) {
    console.log("  (none — no AI activity recorded)");
  } else {
    for (const r of recentAi) {
      console.log(
        `  ${new Date(r.created_at).toLocaleTimeString("he-IL")}  ${r.model}  ${r.duration_ms}ms  ${r.error ? "ERR: " + r.error.slice(0, 80) : "ok"}`
      );
    }
  }

  // What's CRON_SECRET set to (presence only, never the value)?
  console.log("\n=== env health ===");
  console.log(`  CRON_SECRET set?    ${!!process.env.CRON_SECRET}`);
  console.log(`  VERCEL_URL          ${process.env.VERCEL_URL ?? "(not set — local)"}`);
  console.log(`  AI_GATEWAY_API_KEY  ${process.env.AI_GATEWAY_API_KEY ? "set" : "NOT SET"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
