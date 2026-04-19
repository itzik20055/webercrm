import { NextResponse } from "next/server";
import { db, followups, leads, pushSubscriptions } from "@/db";
import { eq, sql } from "drizzle-orm";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const subs = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions);
    if (subs.length === 0) {
      return NextResponse.json({
        ok: false,
        stage: "subscriptions",
        message: "אין מכשירים מנויים. הפעל התראות קודם.",
      });
    }

    const [anyLead] = await db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .limit(1);

    let leadId = anyLead?.id;
    let leadName = anyLead?.name ?? "בדיקה";

    if (!leadId) {
      const [tempLead] = await db
        .insert(leads)
        .values({
          name: "בדיקת התראות",
          phone: "0000000000",
          language: "he",
          audience: "israeli_haredi",
          channelFirst: "whatsapp",
        })
        .returning({ id: leads.id });
      leadId = tempLead.id;
      leadName = "בדיקת התראות";
    }

    const [fup] = await db
      .insert(followups)
      .values({
        leadId,
        dueAt: new Date(),
        reason: "בדיקת זרימה — תזכורת אוטומטית",
      })
      .returning({ id: followups.id });

    const pushResult = await sendPushToAll({
      title: `פולואפ: ${leadName}`,
      body: "בדיקת זרימה — תזכורת אוטומטית",
      url: `/leads/${leadId}`,
      tag: `test-followup-${fup.id}`,
    });

    await db
      .update(followups)
      .set({ completedAt: new Date(), reminderSentAt: new Date() })
      .where(eq(followups.id, fup.id));

    return NextResponse.json({
      ok: true,
      subscriptions: subs.length,
      lead: leadName,
      push: pushResult,
      message:
        pushResult.sent > 0
          ? "פוש נשלח. אם לא הופיעה התראה — הבעיה בצד המכשיר/דפדפן."
          : `הפוש נכשל: ${pushResult.failed} כשלים, ${pushResult.removed} נמחקו`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        stage: "exception",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // GET handler for diagnostics — returns current pipeline state without sending
  const [stats] = await db
    .select({
      subs: sql<number>`(select count(*) from ${pushSubscriptions})::int`,
      openFollowups: sql<number>`(select count(*) from ${followups} where completed_at is null)::int`,
      dueOpenFollowups: sql<number>`(select count(*) from ${followups} where completed_at is null and due_at <= now() and reminder_sent_at is null)::int`,
      pendingFutureFollowups: sql<number>`(select count(*) from ${followups} where completed_at is null and due_at > now())::int`,
    })
    .from(pushSubscriptions)
    .limit(1);

  return NextResponse.json({
    now: new Date().toISOString(),
    subscriptions: stats?.subs ?? 0,
    openFollowups: stats?.openFollowups ?? 0,
    dueRightNow: stats?.dueOpenFollowups ?? 0,
    waitingForFutureTime: stats?.pendingFutureFollowups ?? 0,
    vapidConfigured: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
  });
}
