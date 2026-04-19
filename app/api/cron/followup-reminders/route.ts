import { NextResponse } from "next/server";
import { db, followups, leads } from "@/db";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 6 * 60 * 1000);

  const due = await db
    .select({
      id: followups.id,
      leadId: followups.leadId,
      reason: followups.reason,
      dueAt: followups.dueAt,
      leadName: leads.name,
    })
    .from(followups)
    .innerJoin(leads, eq(followups.leadId, leads.id))
    .where(
      and(
        isNull(followups.completedAt),
        isNull(followups.reminderSentAt),
        lte(followups.dueAt, now),
        gte(followups.dueAt, windowStart)
      )
    )
    .limit(20);

  const results: Array<{ id: string; sent: number; failed: number }> = [];

  for (const f of due) {
    try {
      const r = await sendPushToAll({
        title: `פולואפ: ${f.leadName}`,
        body: f.reason ?? "הגיע הזמן לחזור ללקוח",
        url: `/leads/${f.leadId}`,
        tag: `followup-${f.id}`,
      });
      await db
        .update(followups)
        .set({ reminderSentAt: new Date() })
        .where(eq(followups.id, f.id));
      results.push({ id: f.id, sent: r.sent, failed: r.failed });
    } catch (err) {
      console.error("push failed", f.id, err);
    }
  }

  return NextResponse.json({ ok: true, processed: due.length, results });
}
