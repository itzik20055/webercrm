import { NextResponse, after } from "next/server";
import { runArchivePhoneBatch } from "@/lib/archive-phone";
import { safeErrorMessage } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Self-invoked by the worker when it detects it's about to hit the 300s
 * function ceiling with groups still queued. Resumes the same batch in a
 * fresh function invocation, bypassing the normal session auth (the worker
 * is running server-side and has no session cookie).
 *
 * Auth: shared CRON_SECRET. Same trust level as the existing cron routes.
 * The worker fires this from inside Vercel's network so external callers
 * cannot trigger it.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let batchId: string;
  try {
    const body = (await req.json()) as { batchId?: string };
    if (!body.batchId) {
      return NextResponse.json({ error: "batchId required" }, { status: 400 });
    }
    batchId = body.batchId;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  after(async () => {
    try {
      await runArchivePhoneBatch(batchId);
    } catch (e) {
      console.error(
        "[archive/phone/resume] worker crashed",
        batchId,
        safeErrorMessage(e)
      );
    }
  });

  return NextResponse.json({ ok: true, batchId }, { status: 202 });
}
