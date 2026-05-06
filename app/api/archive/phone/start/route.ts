import { NextResponse, after } from "next/server";
import { db, archiveImports } from "@/db";
import { isAuthenticated } from "@/lib/session";
import { runArchivePhoneBatch } from "@/lib/archive-phone";
import { safeErrorMessage } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Creates an archive_imports row and kicks the worker off in the background
 * via `after()` so the response can return immediately. The UI then polls
 * status by reading the row. If the first invocation hits the 270s ceiling
 * before draining the batch, the user clicks "Continue" → /api/archive/phone/run.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      dateFrom?: string;
      dateTo?: string;
      note?: string;
    };
    if (!body.dateFrom || !body.dateTo) {
      return NextResponse.json(
        { error: "dateFrom ו-dateTo חובה" },
        { status: 400 }
      );
    }
    const from = new Date(body.dateFrom);
    const to = new Date(body.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: "תאריך לא תקין" }, { status: 400 });
    }

    const [created] = await db
      .insert(archiveImports)
      .values({
        kind: "phone",
        status: "pending",
        dateFrom: from,
        dateTo: to,
        note: body.note ?? null,
      })
      .returning({ id: archiveImports.id });

    // Fire-and-forget — the worker writes progress to the row so the UI can
    // poll. If the worker function exceeds 300s the runtime kills it; the
    // batch row stays in `processing` and the user can click Continue.
    after(async () => {
      try {
        await runArchivePhoneBatch(created.id);
      } catch (e) {
        console.error(
          "[archive/phone/start] background batch crashed",
          safeErrorMessage(e)
        );
      }
    });

    return NextResponse.json(
      { ok: true, batchId: created.id, status: "pending" },
      { status: 202 }
    );
  } catch (e) {
    const message = safeErrorMessage(e);
    console.error("[archive/phone/start] failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
