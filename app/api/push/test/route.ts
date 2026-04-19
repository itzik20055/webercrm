import { NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const r = await sendPushToAll({
      title: "Weber — בדיקה",
      body: "אם קיבלת את זה, ההתראות עובדות מושלם 🎉",
      url: "/",
      tag: "test-push",
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
