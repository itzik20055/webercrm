import { config } from "dotenv";
config({ path: ".env.local" });
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

/**
 * Right-to-erasure helper. Two ways to find a customer's data in the
 * archive (which is intentionally hash-only on phone, so a phone alone is
 * the most reliable handle):
 *
 *   npx tsx scripts/delete-customer.ts --phone "0501234567"
 *   npx tsx scripts/delete-customer.ts --search "אברהם משה"
 *
 * Phone mode hashes the phone with sha256 (matching the storage format)
 * and deletes by phone_hash. Search mode looks for the substring inside
 * the archetype jsonb (notes, freeFormInsights). It can produce false
 * positives if the name is common, so it lists matches first and asks
 * for `--confirm` to actually delete.
 */
async function main() {
  const args = process.argv.slice(2);
  const phoneIdx = args.indexOf("--phone");
  const searchIdx = args.indexOf("--search");
  const confirm = args.includes("--confirm");

  const sql = neon(process.env.DATABASE_URL!);

  if (phoneIdx >= 0 && args[phoneIdx + 1]) {
    const phone = args[phoneIdx + 1];
    const hash = createHash("sha256").update(phone).digest("hex");
    console.log(`hash for ${phone}: ${hash.slice(0, 16)}…`);

    const matches = (await sql`
      SELECT id, source, audience, language, outcome, created_at
      FROM conversation_archive
      WHERE phone_hash = ${hash}
    `) as Array<{
      id: string;
      source: string;
      audience: string;
      language: string;
      outcome: string;
      created_at: any;
    }>;

    if (matches.length === 0) {
      console.log("no archive rows for that phone");
      return;
    }

    console.log(`found ${matches.length} archive row(s):`);
    for (const m of matches) {
      console.log(
        `  ${m.id}  ${m.source}  ${m.audience}/${m.language}  outcome=${m.outcome}  ${new Date(m.created_at).toLocaleDateString("he-IL")}`
      );
    }

    if (!confirm) {
      console.log("\n(dry run — pass --confirm to actually delete)");
      return;
    }

    const r = await sql`
      DELETE FROM conversation_archive WHERE phone_hash = ${hash}
    `;
    console.log(`deleted ${(r as any).rowCount ?? "?"} rows`);
    return;
  }

  if (searchIdx >= 0 && args[searchIdx + 1]) {
    const term = args[searchIdx + 1];
    console.log(`searching archetype JSON for "${term}"…`);

    const matches = (await sql`
      SELECT id, source, audience, language, outcome, archetype, created_at
      FROM conversation_archive
      WHERE archetype::text ILIKE ${"%" + term + "%"}
      LIMIT 50
    `) as Array<{
      id: string;
      source: string;
      audience: string;
      language: string;
      outcome: string;
      archetype: any;
      created_at: any;
    }>;

    if (matches.length === 0) {
      console.log("no matches");
      return;
    }

    console.log(`found ${matches.length} match(es):`);
    for (const m of matches) {
      const notes = m.archetype?.persona?.notes ?? "";
      console.log(
        `  ${m.id}  ${m.source}  ${m.audience}/${m.language}  outcome=${m.outcome}  ${new Date(m.created_at).toLocaleDateString("he-IL")}`
      );
      if (notes) console.log(`    notes: ${String(notes).slice(0, 100)}`);
    }

    if (!confirm) {
      console.log("\n(dry run — pass --confirm to actually delete all listed rows)");
      return;
    }

    const r = await sql`
      DELETE FROM conversation_archive
      WHERE archetype::text ILIKE ${"%" + term + "%"}
    `;
    console.log(`deleted ${(r as any).rowCount ?? "?"} rows`);
    return;
  }

  console.log("usage:");
  console.log('  npx tsx scripts/delete-customer.ts --phone "0501234567"');
  console.log('  npx tsx scripts/delete-customer.ts --search "אברהם משה"');
  console.log("  add --confirm to actually delete (without it, runs as a preview)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
