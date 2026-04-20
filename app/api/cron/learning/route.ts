import { NextResponse } from "next/server";
import { runLearningPass } from "@/lib/learning";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Nightly learning cron. Mines completed/active conversations for איציק's
 * effective and ineffective messages, scores each, and saves into
 * voice_examples for retrieval at draft time. Idempotent — safe to re-run.
 */
export async function GET(req: Request) {
  // Vercel Cron sends an Authorization header with CRON_SECRET when set.
  // If the env var is configured, require the header to match.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const leadLimit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : 30;

  try {
    const result = await runLearningPass({ leadLimit });
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
