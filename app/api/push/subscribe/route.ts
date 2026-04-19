import { NextResponse, type NextRequest } from "next/server";
import { db, pushSubscriptions } from "@/db";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: req.headers.get("user-agent"),
    })
    .onConflictDoNothing({ target: pushSubscriptions.endpoint });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  if (!body?.endpoint) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, body.endpoint));
  return NextResponse.json({ ok: true });
}
