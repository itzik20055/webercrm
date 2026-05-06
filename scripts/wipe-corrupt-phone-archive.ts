import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  console.log("=== before ===");
  const before = (await sql`
    SELECT
      (SELECT count(*)::int FROM conversation_archive WHERE source = 'phone_archive') AS phone_rows,
      (SELECT count(*)::int FROM conversation_archive WHERE source = 'whatsapp_archive') AS wa_rows,
      (SELECT count(*)::int FROM archive_imports WHERE kind = 'phone') AS phone_batches
  `) as Array<{ phone_rows: number; wa_rows: number; phone_batches: number }>;
  console.log(before[0]);

  console.log("\n=== deleting phone_archive rows ===");
  const delRows = await sql`
    DELETE FROM conversation_archive WHERE source = 'phone_archive'
  `;
  console.log("rows affected:", (delRows as any).rowCount ?? "?");

  console.log("\n=== deleting phone archive_imports rows ===");
  const delBatches = await sql`
    DELETE FROM archive_imports WHERE kind = 'phone'
  `;
  console.log("batches affected:", (delBatches as any).rowCount ?? "?");

  console.log("\n=== after ===");
  const after = (await sql`
    SELECT
      (SELECT count(*)::int FROM conversation_archive WHERE source = 'phone_archive') AS phone_rows,
      (SELECT count(*)::int FROM conversation_archive WHERE source = 'whatsapp_archive') AS wa_rows,
      (SELECT count(*)::int FROM archive_imports WHERE kind = 'phone') AS phone_batches
  `) as Array<{ phone_rows: number; wa_rows: number; phone_batches: number }>;
  console.log(after[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
