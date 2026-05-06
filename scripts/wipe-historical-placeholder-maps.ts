import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

/**
 * One-shot privacy fix: zero out the placeholderMap column on all existing
 * ai_audit_log rows. The map carried the deanonymization key (e.g.
 * `{ "[NAME]": "אברהם משה" }`) and undid the anonymization layer if a DB
 * dump leaked. Going forward, no new rows persist this map. This script
 * sweeps the historical entries.
 */
async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const before = (await sql`
    SELECT count(*)::int AS rows_with_map
    FROM ai_audit_log
    WHERE placeholder_map IS NOT NULL
  `) as Array<{ rows_with_map: number }>;
  console.log("rows currently carrying a placeholder map:", before[0].rows_with_map);

  const r = await sql`
    UPDATE ai_audit_log
    SET placeholder_map = NULL
    WHERE placeholder_map IS NOT NULL
  `;
  console.log("rows updated:", (r as any).rowCount ?? "?");

  const after = (await sql`
    SELECT count(*)::int AS rows_with_map
    FROM ai_audit_log
    WHERE placeholder_map IS NOT NULL
  `) as Array<{ rows_with_map: number }>;
  console.log("rows still carrying a map:", after[0].rows_with_map);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
