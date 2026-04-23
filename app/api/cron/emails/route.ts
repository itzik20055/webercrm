import { NextResponse } from "next/server";
import { processEmailImport } from "@/lib/email-import-worker";
import { runEmailSync } from "@/lib/email-sync-worker";

export const runtime = "nodejs";
// Matches call-recordings/whatsapp cron — long enough to churn through the
// work we fetch. Most 4-hour batches finish in well under 60s.
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Match the pattern used by the other cron routes: Vercel cron sends
  // Authorization: Bearer <CRON_SECRET>. Allow local calls (no secret set).
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // 1) Drain any queued new_import rows (up to 3 per tick to cap cost).
    const importResults: Array<{ id?: string; status: string; error?: string }> = [];
    for (let i = 0; i < 3; i++) {
      const r = await processEmailImport();
      if (r.status === "no_work") break;
      importResults.push(r);
    }

    // 2) Run the 4-hour sync — pulls new messages for watched leads.
    const sync = await runEmailSync();

    return NextResponse.json({
      ok: true,
      imports: importResults,
      sync,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[cron/emails] failed:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
