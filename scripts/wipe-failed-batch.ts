import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Wipe everything phone-related — failed batch + any orphan rows from
  // the row pasted in the previous turn (which had non-anonymized names
  // and was never persisted because the insert errored, but defense in
  // depth: clear anything older than the NER fix).
  await sql`DELETE FROM conversation_archive WHERE source = 'phone_archive'`;
  await sql`DELETE FROM archive_imports WHERE kind = 'phone'`;

  const after = (await sql`
    SELECT
      (SELECT count(*)::int FROM conversation_archive WHERE source = 'phone_archive') AS phone_rows,
      (SELECT count(*)::int FROM archive_imports WHERE kind = 'phone') AS phone_batches
  `) as Array<{ phone_rows: number; phone_batches: number }>;
  console.log("after:", after[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
