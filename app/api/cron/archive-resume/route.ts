import { NextResponse, after } from "next/server";
import { sql } from "drizzle-orm";
import { db, archiveImports } from "@/db";
import { runArchivePhoneBatch } from "@/lib/archive-phone";
import { safeErrorMessage } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Reliable safety net for stuck archive batches. Runs every 2 minutes via
 * Vercel cron. Finds phone-archive batches that are still in `processing`
 * but whose worker has been silent for >90s (heartbeat stale) and fires a
 * fresh runArchivePhoneBatch via after().
 *
 * Self-resume (worker → /resume HTTP fetch) is the fast path. This cron is
 * the slow path — it picks up batches whose self-resume failed for any
 * reason (CRON_SECRET missing, network blip, watchdog never fired).
 *
 * The worker uses an atomic UPDATE-RETURNING lock keyed off the same
 * heartbeat column, so this cron firing while a live worker is still
 * running on the same batch is a benign no-op.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const stale = (await db
      .select({
        id: archiveImports.id,
        status: archiveImports.status,
        lastHeartbeatAt: archiveImports.lastHeartbeatAt,
      })
      .from(archiveImports)
      .where(
        sql`${archiveImports.kind} = 'phone' AND ${archiveImports.status} = 'processing' AND (${archiveImports.lastHeartbeatAt} IS NULL OR ${archiveImports.lastHeartbeatAt} < NOW() - INTERVAL '90 seconds')`
      )) as Array<{
      id: string;
      status: string;
      lastHeartbeatAt: Date | null;
    }>;

    if (stale.length === 0) {
      return NextResponse.json({ ok: true, resumed: 0 });
    }

    for (const b of stale) {
      after(async () => {
        try {
          await runArchivePhoneBatch(b.id);
        } catch (e) {
          console.error(
            "[cron/archive-resume] worker crashed",
            b.id,
            safeErrorMessage(e)
          );
        }
      });
    }

    return NextResponse.json({
      ok: true,
      resumed: stale.length,
      batchIds: stale.map((b) => b.id),
    });
  } catch (e) {
    const message = safeErrorMessage(e);
    console.error("[cron/archive-resume] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
