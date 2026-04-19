import { NextResponse } from "next/server";
import { db, followups, leads } from "@/db";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { sendPushToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const sanityFloor = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
        gte(followups.dueAt, sanityFloor)
      )
    )
    .limit(50);

  console.log(`[cron] tick at ${now.toISOString()} — found ${due.length} due followup(s)`);

  const results: Array<{ id: string; lead: string; sent: number; failed: number }> = [];

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
      console.log(`[cron] sent followup ${f.id} (${f.leadName}) → ${r.sent} device(s), ${r.failed} failed, ${r.removed} removed`);
      results.push({ id: f.id, lead: f.leadName, sent: r.sent, failed: r.failed });
    } catch (err) {
      console.error(`[cron] push failed for ${f.id}`, err);
    }
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), processed: due.length, results });
}
