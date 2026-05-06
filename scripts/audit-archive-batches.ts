import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Recent archive_imports (last 7 days)
  const batches = (await sql`
    SELECT id, kind, status, date_from, date_to, item_count,
           processed_count, success_count, failure_count, note, error,
           created_at, started_at, finished_at
    FROM archive_imports
    ORDER BY created_at DESC
    LIMIT 20
  `) as Array<{
    id: string;
    kind: string;
    status: string;
    date_from: string | null;
    date_to: string | null;
    item_count: number | null;
    processed_count: number;
    success_count: number;
    failure_count: number;
    note: string | null;
    error: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>;

  const fmt = (d: any): string => {
    if (!d) return "—";
    return new Date(d).toLocaleString("he-IL");
  };
  const fmtDate = (d: any): string => {
    if (!d) return "—";
    return new Date(d).toISOString().slice(0, 10);
  };

  console.log("=== ARCHIVE IMPORTS (latest 20) ===");
  for (const b of batches) {
    console.log(
      `\nbatch ${b.id.slice(0, 8)}…  kind=${b.kind}  status=${b.status}`
    );
    console.log(`  range: ${fmtDate(b.date_from)} → ${fmtDate(b.date_to)}`);
    console.log(
      `  counts: items=${b.item_count}  processed=${b.processed_count}  success=${b.success_count}  fail=${b.failure_count}`
    );
    console.log(`  created: ${fmt(b.created_at)}`);
    if (b.started_at)
      console.log(
        `  started: ${fmt(b.started_at)}  finished: ${fmt(b.finished_at)}`
      );
    if (b.note) console.log(`  note: ${b.note}`);
    if (b.error) console.log(`  ERROR: ${b.error}`);
  }

  // For each phone batch, look at what landed in conversation_archive
  const phoneBatches = batches.filter((b) => b.kind === "phone");
  console.log(`\n\n=== PER-BATCH ARCHIVE CONTENTS (${phoneBatches.length} phone batches) ===`);

  for (const b of phoneBatches) {
    const rows = (await sql`
      SELECT id, audience, language, outcome, outcome_confidence,
             interaction_count, conversation_started_at, conversation_ended_at,
             phone_hash, archetype, created_at
      FROM conversation_archive
      WHERE import_batch_id = ${b.id}
      ORDER BY created_at ASC
    `) as Array<{
      id: string;
      audience: string;
      language: string;
      outcome: string;
      outcome_confidence: number;
      interaction_count: number;
      conversation_started_at: string | null;
      conversation_ended_at: string | null;
      phone_hash: string;
      archetype: any;
      created_at: string;
    }>;

    console.log(
      `\nbatch ${b.id.slice(0, 8)}…  → ${rows.length} archive rows`
    );

    // Outcome breakdown
    const byOutcome = rows.reduce(
      (acc, r) => {
        acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    console.log("  outcomes:", JSON.stringify(byOutcome));

    // Audience breakdown
    const byAudience = rows.reduce(
      (acc, r) => {
        acc[r.audience] = (acc[r.audience] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    console.log("  audiences:", JSON.stringify(byAudience));

    // Confidence distribution
    if (rows.length > 0) {
      const confs = rows.map((r) => r.outcome_confidence).sort((a, b) => a - b);
      const avg =
        confs.reduce((a, c) => a + c, 0) / confs.length;
      const median = confs[Math.floor(confs.length / 2)];
      const highConf = confs.filter((c) => c >= 0.6).length;
      console.log(
        `  confidence: avg=${avg.toFixed(2)}  median=${median?.toFixed(2)}  ≥0.6: ${highConf}/${confs.length}`
      );

      // Interaction count distribution
      const interactions = rows
        .map((r) => r.interaction_count)
        .sort((a, b) => a - b);
      const minI = interactions[0];
      const maxI = interactions[interactions.length - 1];
      const avgI = interactions.reduce((a, c) => a + c, 0) / interactions.length;
      console.log(
        `  interactions per archive: min=${minI}  max=${maxI}  avg=${avgI.toFixed(1)}`
      );

      // Sample 3 rows for sanity check
      console.log("  --- samples ---");
      const samples = rows.slice(0, 3);
      for (const r of samples) {
        console.log(
          `    ${r.id.slice(0, 8)}…  outcome=${r.outcome}  conf=${r.outcome_confidence}  audience=${r.audience}  interactions=${r.interaction_count}`
        );
        const arch = r.archetype as any;
        if (arch?.persona) {
          console.log(
            `      persona: community=${arch.persona.community ?? "?"}  notes=${(arch.persona.notes ?? "").slice(0, 60)}`
          );
        }
        if (arch?.winningAngle) {
          console.log(`      winningAngle: ${String(arch.winningAngle).slice(0, 80)}`);
        }
        if (arch?.objections) {
          console.log(
            `      objections: ${JSON.stringify(arch.objections).slice(0, 80)}`
          );
        }
      }
    }
  }

  // Sanity: total in conversation_archive
  const totals = (await sql`
    SELECT source, count(*)::int AS n,
           count(*) FILTER (WHERE outcome = 'booked')::int AS booked,
           count(*) FILTER (WHERE outcome = 'lost')::int AS lost,
           count(*) FILTER (WHERE outcome = 'unknown')::int AS unknown
    FROM conversation_archive
    GROUP BY source
  `) as Array<{
    source: string;
    n: number;
    booked: number;
    lost: number;
    unknown: number;
  }>;

  console.log("\n\n=== TOTAL conversation_archive ===");
  for (const t of totals) {
    console.log(
      `  ${t.source}: total=${t.n}  booked=${t.booked}  lost=${t.lost}  unknown=${t.unknown}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
