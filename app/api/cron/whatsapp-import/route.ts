import { NextResponse } from "next/server";
import { processOne } from "@/lib/whatsapp-import-worker";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Safety-net cron: picks up any `pending` imports that the fire-and-forget
 * handler in /api/leads/import-whatsapp didn't finish (function died early,
 * cold start after deploy, etc). Runs every minute.
 *
 * Atomic claim inside `processOne` prevents double-processing if this ever
 * overlaps with the upload-triggered worker.
 */
export async function GET() {
  const results: Array<{ id?: string; status: string; error?: string }> = [];
  // Cap per-tick to avoid chewing through 20 uploads in one cron run and
  // blowing the budget. Each tick grabs up to 3; the next tick gets the rest.
  for (let i = 0; i < 3; i++) {
    const r = await processOne();
    if (r.status === "no_work") break;
    results.push(
      "error" in r
        ? { id: r.id, status: r.status, error: r.error }
        : { id: r.id, status: r.status }
    );
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
