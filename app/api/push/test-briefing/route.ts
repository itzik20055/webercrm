import { NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/push";
import { computeMorningBriefing } from "@/lib/briefing";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const briefing = await computeMorningBriefing();
    const r = await sendPushToAll({
      title: briefing.title,
      body: briefing.body,
      url: "/",
      tag: "morning-briefing",
    });
    return NextResponse.json({ ok: true, ...briefing, ...r });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
