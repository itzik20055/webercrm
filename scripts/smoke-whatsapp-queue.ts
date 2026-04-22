/**
 * Smoke-test the WhatsApp import queue plumbing (no AI spend).
 *   [1] schema: pending_whatsapp_imports present with right columns
 *   [2] insert with unique content_hash works, duplicate insert is a no-op
 *   [3] atomic claim flips pending → processing exactly once under parallel claims
 *   [4] bytea round-trips (read back the same bytes)
 * Cleans up after itself.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createHash } from "node:crypto";
import { db, pendingWhatsAppImports } from "../db";
import { and, eq, sql } from "drizzle-orm";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "OK " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\n[1] schema present");
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'pending_whatsapp_imports'
  `)) as unknown as { rows: { column_name: string }[] };
  const have = new Set(
    (cols.rows ?? (cols as unknown as { column_name: string }[])).map(
      (c) => c.column_name
    )
  );
  for (const c of [
    "content_hash",
    "file_bytes",
    "status",
    "processing_started_at",
    "extraction",
    "match_candidate_ids",
  ]) {
    record(`pending_whatsapp_imports.${c}`, have.has(c));
  }

  const cleanup: string[] = [];

  console.log("\n[2] unique content_hash");
  const payload = Buffer.from("__smoke_wa_queue_" + Date.now());
  const hash = createHash("sha256").update(payload).digest("hex");
  try {
    const [first] = await db
      .insert(pendingWhatsAppImports)
      .values({
        contentHash: hash,
        originalFilename: "smoke.zip",
        fileBytes: payload,
        isZip: true,
      })
      .returning({ id: pendingWhatsAppImports.id });
    cleanup.push(first.id);
    record("first insert", !!first.id);

    const second = await db
      .insert(pendingWhatsAppImports)
      .values({
        contentHash: hash,
        originalFilename: "smoke2.zip",
        fileBytes: payload,
        isZip: true,
      })
      .onConflictDoNothing({ target: pendingWhatsAppImports.contentHash })
      .returning({ id: pendingWhatsAppImports.id });
    record(
      "duplicate insert is no-op",
      second.length === 0,
      `returned ${second.length} rows`
    );

    console.log("\n[3] bytea round-trip");
    const [readBack] = await db
      .select({ bytes: pendingWhatsAppImports.fileBytes })
      .from(pendingWhatsAppImports)
      .where(eq(pendingWhatsAppImports.id, first.id));
    record(
      "bytea matches",
      !!readBack?.bytes && Buffer.compare(readBack.bytes, payload) === 0,
      `${readBack?.bytes?.length ?? 0} bytes`
    );

    console.log("\n[4] atomic claim — parallel losers get nothing");
    const claim = () =>
      db
        .update(pendingWhatsAppImports)
        .set({
          status: "processing",
          processingStartedAt: new Date(),
        })
        .where(
          and(
            eq(pendingWhatsAppImports.id, first.id),
            eq(pendingWhatsAppImports.status, "pending")
          )
        )
        .returning({ id: pendingWhatsAppImports.id });
    const [a, b, c] = await Promise.all([claim(), claim(), claim()]);
    const winners = [a, b, c].filter((r) => r.length > 0).length;
    record(
      "exactly one claim wins",
      winners === 1,
      `winners=${winners}`
    );
  } finally {
    for (const id of cleanup) {
      await db
        .delete(pendingWhatsAppImports)
        .where(eq(pendingWhatsAppImports.id, id));
    }
  }

  const fail = checks.filter((x) => !x.ok);
  console.log(`\n=== ${checks.length - fail.length}/${checks.length} passed ===`);
  if (fail.length > 0) {
    console.log("FAILURES:");
    for (const f of fail) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
