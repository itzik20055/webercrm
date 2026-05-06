import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { runArchivePhoneBatch } from "@/lib/archive-phone";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Continues processing an existing batch. Used after the initial /start hit
 * the 270s ceiling and left status='processing'. Idempotent against the
 * (importBatchId, phoneHash) dedup — re-running just picks up phones not
 * yet persisted.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { batchId?: string };
    if (!body.batchId) {
      return NextResponse.json({ error: "batchId חובה" }, { status: 400 });
    }
    const result = await runArchivePhoneBatch(body.batchId);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[archive/phone/run] failed", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
