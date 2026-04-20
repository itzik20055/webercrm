import { fetchPendingCallRecordings, markProcessed } from "./gmail-imap";
import { processCallRecording } from "./call-recording";

export type PullResult = {
  ok: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  stoppedEarly: boolean;
  durationMs: number;
  results: Array<{
    uid: number;
    status: "ok" | "skipped" | "error";
    leadId?: string;
    reason?: string;
  }>;
  error?: string;
};

/**
 * Runs one batch of Gmail → transcript → extraction → pending-review.
 * Each UID is marked processed **immediately** after processing (or failure)
 * so a timeout partway through doesn't cost us the work that already landed.
 * Early-exits if we've been running for more than 270s, so Vercel's 300s cap
 * doesn't kill us mid-write.
 */
export async function runCallRecordingsPull(
  opts: { limit?: number } = {}
): Promise<PullResult> {
  const started = Date.now();
  const limit = opts.limit ?? 2;

  let mails;
  try {
    mails = await fetchPendingCallRecordings(limit);
  } catch (e) {
    console.error("[call-recordings] fetch failed", e);
    return {
      ok: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      stoppedEarly: false,
      durationMs: Date.now() - started,
      results: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const results: PullResult["results"] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedEarly = false;

  for (const m of mails) {
    if (Date.now() - started > 270_000) {
      console.warn("[call-recordings] approaching 300s timeout, stopping early");
      stoppedEarly = true;
      break;
    }

    try {
      const r = await processCallRecording(m);
      results.push(r);
      if (r.status === "ok") succeeded++;
      else if (r.status === "skipped") skipped++;

      // Mark immediately so a later timeout doesn't cost us this success.
      // We also mark "skipped" entries — they're not going to change on retry
      // (subject didn't match / no attachment).
      try {
        await markProcessed([m.uid]);
      } catch (e) {
        console.error("[call-recordings] markProcessed failed for", m.uid, e);
      }
    } catch (e) {
      console.error("[call-recordings] process failed", m.uid, e);
      failed++;
      results.push({
        uid: m.uid,
        status: "error",
        reason: e instanceof Error ? e.message : String(e),
      });
      // NOTE: intentionally NOT marking errored UIDs as processed — we want
      // them retried on the next run.
    }
  }

  return {
    ok: true,
    processed: results.length,
    succeeded,
    failed,
    skipped,
    stoppedEarly,
    durationMs: Date.now() - started,
    results,
  };
}
