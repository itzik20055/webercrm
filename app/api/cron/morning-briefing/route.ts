import { NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/push";
import { computeMorningBriefing } from "@/lib/briefing";
import { getSetting, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// en-CA formats dates as YYYY-MM-DD, which is ISO-sortable and stable.
const ISRAEL_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";

  const now = new Date();
  const today = ISRAEL_DATE.format(now);

  if (!dryRun && !force) {
    const lastSent = await getSetting("briefing_last_sent_date");
    if (lastSent === today) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        reason: "already-sent-today",
        today,
      });
    }
  }

  const briefing = await computeMorningBriefing(now);

  if (briefing.isEmpty) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      reason: "nothing-to-report",
      now: now.toISOString(),
    });
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dry: true, ...briefing });
  }

  let push: { sent: number; failed: number; removed: number } | null = null;
  try {
    push = await sendPushToAll({
      title: briefing.title,
      body: briefing.body,
      url: "/",
      tag: "morning-briefing",
    });
    await setSetting("briefing_last_sent_date", today);
  } catch (e) {
    console.error("[cron/morning-briefing] push failed", e);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        title: briefing.title,
        body: briefing.body,
      },
      { status: 500 }
    );
  }

  console.log(
    `[cron/morning-briefing] ${briefing.title} | ${briefing.body} | sent=${push.sent} failed=${push.failed}`
  );

  return NextResponse.json({ ok: true, ...briefing, push });
}
