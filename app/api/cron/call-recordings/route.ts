import { NextResponse } from "next/server";
import { runCallRecordingsPull } from "@/lib/call-recordings-runner";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await runCallRecordingsPull({ limit: 2 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
