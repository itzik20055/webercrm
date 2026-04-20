/**
 * Dump current product knowledge base from production DB.
 * Run with: npx tsx scripts/dump-kb.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { asc } from "drizzle-orm";
import * as schema from "../db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const sql = neon(url);
  const db = drizzle(sql, { schema, casing: "snake_case" });

  const rows = await db
    .select()
    .from(schema.productKb)
    .orderBy(asc(schema.productKb.category), asc(schema.productKb.title));

  const byCategory = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  console.log(`\n=== KB DUMP — ${rows.length} entries total ===\n`);
  for (const [category, list] of byCategory) {
    console.log(`\n──────── ${category.toUpperCase()} (${list.length}) ────────`);
    for (const r of list) {
      console.log(`\n• [${r.language}] ${r.title} ${r.active ? "" : "[INACTIVE]"}`);
      console.log(r.content);
    }
  }
  console.log("\n=== END ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
