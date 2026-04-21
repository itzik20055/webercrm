import { NextResponse } from "next/server";
import { runCallRecordingsPull } from "@/lib/call-recordings-runner";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  const paused = (await getSetting("call_recordings_paused")) === "1";
  if (paused) {
    return NextResponse.json({ ok: true, paused: true, processed: 0 });
  }
  const result = await runCallRecordingsPull({ limit: 2 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
