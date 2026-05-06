import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const r = (await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'conversation_archive'
    ORDER BY indexname
  `) as Array<{ indexname: string; indexdef: string }>;
  for (const i of r) {
    console.log(i.indexname);
    console.log("  " + i.indexdef);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
