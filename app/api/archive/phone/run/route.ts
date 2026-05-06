import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, archiveImports } from "@/db";
import { isAuthenticated } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Read-only status endpoint. Returns the current state of an archive_imports
 * row so the UI can poll progress. The actual work happens in the background
 * worker triggered by /start. Polling /run does NOT trigger more work — that
 * is what caused the original race condition where every 5-second poll spawned
 * a concurrent worker and produced duplicate rows.
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
    const [row] = await db
      .select()
      .from(archiveImports)
      .where(eq(archiveImports.id, body.batchId));
    if (!row) {
      return NextResponse.json({ error: "batch not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      batchId: row.id,
      status: row.status,
      processedCount: row.processedCount,
      successCount: row.successCount,
      failureCount: row.failureCount,
      itemCount: row.itemCount,
      error: row.error,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[archive/phone/run] failed", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
