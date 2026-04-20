import { NextResponse } from "next/server";
import { fetchPendingCallRecordings, markProcessed } from "@/lib/gmail-imap";
import { processCallRecording } from "@/lib/call-recording";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let mails;
  try {
    mails = await fetchPendingCallRecordings(20);
  } catch (e) {
    console.error("[cron call-recordings] fetch failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  if (mails.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, durationMs: Date.now() - started });
  }

  const results = [];
  const successUids: number[] = [];
  for (const m of mails) {
    try {
      const r = await processCallRecording(m);
      results.push(r);
      if (r.status === "ok" || r.status === "skipped") {
        successUids.push(m.uid);
      }
    } catch (e) {
      console.error("[cron call-recordings] process failed", m.uid, e);
      results.push({
        uid: m.uid,
        status: "error",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (successUids.length > 0) {
    try {
      await markProcessed(successUids);
    } catch (e) {
      console.error("[cron call-recordings] markProcessed failed", e);
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    successUids: successUids.length,
    durationMs: Date.now() - started,
    results,
  });
}
