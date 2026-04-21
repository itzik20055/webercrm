import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db, followups, leads, pendingCallRecordings } from "@/db";

/**
 * Followups due now or overdue. Drives the /queue tab badge.
 */
export async function getQueueCount(): Promise<number> {
  const now = new Date();
  const [dueRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followups)
    .where(and(isNull(followups.completedAt), lte(followups.dueAt, now)));
  return dueRow?.c ?? 0;
}

/**
 * Inbox items waiting for triage: pending call recordings + needsReview leads.
 * Drives the /inbox tab badge.
 */
export async function getInboxCount(): Promise<number> {
  const [pendingRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(pendingCallRecordings)
    .where(eq(pendingCallRecordings.status, "pending"));
  const [reviewRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.needsReview, true));
  return (pendingRow?.c ?? 0) + (reviewRow?.c ?? 0);
}
