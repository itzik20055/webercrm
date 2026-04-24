import { NextResponse } from "next/server";
import { runLearningBackfill } from "@/lib/learning";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * One-shot historical backfill. Does NOT touch the nightly cursor — safe to
 * run in parallel with /api/cron/learning. Paginate with ?page=N&size=N until
 * the response returns hasMore=false.
 *
 * curl -H "Authorization: Bearer $CRON_SECRET" \
 *   "https://.../api/cron/learning/backfill?page=0&size=30"
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0));
  const sizeParam = Number(url.searchParams.get("size") ?? 30);
  const size = Math.max(1, Math.min(50, Number.isFinite(sizeParam) ? sizeParam : 30));

  try {
    const result = await runLearningBackfill({ page, size });
    const summary = result.processed.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        if (r.status === "ok") {
          acc.savedTotal += r.saved ?? 0;
          acc.duplicatesTotal += r.duplicates ?? 0;
        }
        return acc;
      },
      { ok: 0, skipped: 0, error: 0, savedTotal: 0, duplicatesTotal: 0 } as Record<
        string,
        number
      >
    );
    return NextResponse.json({ ...result, summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
