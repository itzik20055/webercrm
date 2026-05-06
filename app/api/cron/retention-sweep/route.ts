import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Daily retention sweep — deletes historical AI/archive data that is no
 * longer useful for the live pipeline. Reduces standing exposure: data
 * that no longer informs draft generation is dropped.
 *
 * Currently sweeps:
 *  - `conversation_archive`: rows older than ARCHIVE_RETENTION_MONTHS
 *  - `ai_audit_log`: rows older than AUDIT_LOG_RETENTION_DAYS
 *
 * Both windows are conservative — feel free to shorten.
 */
const ARCHIVE_RETENTION_MONTHS = 18;
const AUDIT_LOG_RETENTION_DAYS = 90;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const archiveRes = await db.execute(sql`
      DELETE FROM conversation_archive
      WHERE created_at < NOW() - (${ARCHIVE_RETENTION_MONTHS}::int * INTERVAL '1 month')
    `);
    const auditRes = await db.execute(sql`
      DELETE FROM ai_audit_log
      WHERE created_at < NOW() - (${AUDIT_LOG_RETENTION_DAYS}::int * INTERVAL '1 day')
    `);

    const archiveDeleted =
      (archiveRes as { rowCount?: number }).rowCount ?? 0;
    const auditDeleted = (auditRes as { rowCount?: number }).rowCount ?? 0;

    return NextResponse.json({
      ok: true,
      archive: {
        retentionMonths: ARCHIVE_RETENTION_MONTHS,
        deleted: archiveDeleted,
      },
      auditLog: {
        retentionDays: AUDIT_LOG_RETENTION_DAYS,
        deleted: auditDeleted,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/retention-sweep] failed", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
