import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  const total = (await sql`
    SELECT
      count(*)::int AS all_rows,
      count(*) FILTER (WHERE outcome = 'booked')::int AS booked,
      count(*) FILTER (WHERE outcome = 'lost')::int AS lost,
      count(*) FILTER (WHERE outcome = 'unknown')::int AS unknown
    FROM conversation_archive
  `) as Array<{ all_rows: number; booked: number; lost: number; unknown: number }>;

  const t = total[0];
  console.log("=== conversation_archive total counts (matches the UI) ===");
  console.log(
    `  all=${t.all_rows}  booked=${t.booked}  lost=${t.lost}  unknown=${t.unknown}`
  );
  console.log("\n  user reported: 65 archive / 11 booked / 14 lost");
  console.log(
    `  match? all=${t.all_rows === 65}  booked=${t.booked === 11}  lost=${t.lost === 14}`
  );

  // Now show what those numbers would be if we de-duplicated by (batch_id, phone_hash)
  const distinctRows = (await sql`
    WITH deduped AS (
      SELECT DISTINCT ON (import_batch_id, phone_hash)
        outcome
      FROM conversation_archive
      WHERE phone_hash IS NOT NULL
      ORDER BY import_batch_id, phone_hash, created_at DESC
    )
    SELECT
      count(*)::int AS rows,
      count(*) FILTER (WHERE outcome = 'booked')::int AS booked,
      count(*) FILTER (WHERE outcome = 'lost')::int AS lost,
      count(*) FILTER (WHERE outcome = 'unknown')::int AS unknown
    FROM deduped
  `) as Array<{ rows: number; booked: number; lost: number; unknown: number }>;

  const wa = (await sql`
    SELECT
      count(*)::int AS rows,
      count(*) FILTER (WHERE outcome = 'booked')::int AS booked,
      count(*) FILTER (WHERE outcome = 'lost')::int AS lost,
      count(*) FILTER (WHERE outcome = 'unknown')::int AS unknown
    FROM conversation_archive
    WHERE source = 'whatsapp_archive'
  `) as Array<{ rows: number; booked: number; lost: number; unknown: number }>;

  const d = distinctRows[0];
  const w = wa[0];
  console.log("\n=== If we de-duped phone_archive by (batch, phone_hash) ===");
  console.log(
    `  phone_archive distinct: ${d.rows} (booked=${d.booked} lost=${d.lost} unknown=${d.unknown})`
  );
  console.log(
    `  whatsapp_archive: ${w.rows} (booked=${w.booked} lost=${w.lost} unknown=${w.unknown})`
  );
  console.log(
    `  TRUE archive: ${d.rows + w.rows} (booked=${d.booked + w.booked} lost=${d.lost + w.lost} unknown=${d.unknown + w.unknown})`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
