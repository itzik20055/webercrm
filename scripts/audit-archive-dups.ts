import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("=== DUPLICATE phone_hash WITHIN A BATCH ===");
  const dups = (await sql`
    SELECT import_batch_id::text AS batch,
           phone_hash,
           count(*)::int AS n,
           min(created_at) AS first_at,
           max(created_at) AS last_at,
           array_agg(outcome ORDER BY created_at) AS outcomes,
           array_agg(interaction_count ORDER BY created_at) AS interactions
    FROM conversation_archive
    WHERE source = 'phone_archive'
    GROUP BY import_batch_id, phone_hash
    HAVING count(*) > 1
    ORDER BY n DESC
    LIMIT 30
  `) as Array<{
    batch: string;
    phone_hash: string;
    n: number;
    first_at: any;
    last_at: any;
    outcomes: string[];
    interactions: number[];
  }>;

  if (dups.length === 0) {
    console.log("(no duplicates within a batch)");
  } else {
    for (const d of dups) {
      const ms =
        new Date(d.last_at).getTime() - new Date(d.first_at).getTime();
      console.log(
        `batch ${d.batch.slice(0, 8)}…  phone ${d.phone_hash.slice(0, 8)}…  → ${d.n} rows  span=${(ms / 1000).toFixed(1)}s  outcomes=${JSON.stringify(d.outcomes)}  interactions=${JSON.stringify(d.interactions)}`
      );
    }
  }

  console.log("\n=== DUPLICATE phone_hash ACROSS BATCHES ===");
  const crossDups = (await sql`
    SELECT phone_hash,
           count(distinct import_batch_id)::int AS batches,
           count(*)::int AS rows,
           array_agg(distinct outcome) AS outcomes
    FROM conversation_archive
    WHERE source = 'phone_archive'
    GROUP BY phone_hash
    HAVING count(distinct import_batch_id) > 1
    ORDER BY rows DESC
    LIMIT 10
  `) as Array<{
    phone_hash: string;
    batches: number;
    rows: number;
    outcomes: string[];
  }>;
  if (crossDups.length === 0) {
    console.log("(no phone_hash repeated across batches — June 1-11 vs June 12-18 don't overlap by customer)");
  } else {
    for (const d of crossDups) {
      console.log(
        `  phone ${d.phone_hash.slice(0, 8)}…  in ${d.batches} batches, ${d.rows} total rows, outcomes=${JSON.stringify(d.outcomes)}`
      );
    }
  }

  console.log("\n=== PER BATCH: distinct customers vs total rows ===");
  const counts = (await sql`
    SELECT import_batch_id::text AS batch,
           count(*)::int AS total_rows,
           count(distinct phone_hash)::int AS distinct_customers,
           sum(interaction_count)::int AS total_interactions
    FROM conversation_archive
    WHERE source = 'phone_archive'
    GROUP BY import_batch_id
    ORDER BY total_rows DESC
  `) as Array<{
    batch: string;
    total_rows: number;
    distinct_customers: number;
    total_interactions: number;
  }>;
  for (const c of counts) {
    const dupRatio = c.total_rows / Math.max(c.distinct_customers, 1);
    console.log(
      `  batch ${c.batch.slice(0, 8)}…  rows=${c.total_rows}  distinct customers=${c.distinct_customers}  total interactions covered=${c.total_interactions}  dup-factor=${dupRatio.toFixed(2)}x`
    );
  }

  console.log("\n=== TIME-CLUSTERS — rows created within seconds of each other ===");
  const tightTimes = (await sql`
    SELECT id, import_batch_id::text AS batch, phone_hash, created_at, interaction_count, outcome
    FROM conversation_archive
    WHERE source = 'phone_archive'
    ORDER BY created_at ASC
    LIMIT 100
  `) as Array<{
    id: string;
    batch: string;
    phone_hash: string;
    created_at: any;
    interaction_count: number;
    outcome: string;
  }>;
  let prev: any = null;
  let cluster: typeof tightTimes = [];
  const printCluster = (rows: typeof tightTimes) => {
    if (rows.length < 2) return;
    const dt =
      new Date(rows[rows.length - 1].created_at).getTime() -
      new Date(rows[0].created_at).getTime();
    const distinctPhones = new Set(rows.map((r) => r.phone_hash)).size;
    console.log(
      `  cluster of ${rows.length} rows in ${(dt / 1000).toFixed(1)}s  distinct phones=${distinctPhones}  batch=${rows[0].batch.slice(0, 8)}…`
    );
  };
  for (const t of tightTimes) {
    const ts = new Date(t.created_at).getTime();
    if (prev && ts - prev < 3000) {
      cluster.push(t);
    } else {
      printCluster(cluster);
      cluster = [t];
    }
    prev = ts;
  }
  printCluster(cluster);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
