import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db, leads, followups } from "@/db";

/**
 * Total "act now" items: leads that need review + followups due now or
 * already overdue. Drives the bottom-nav badge.
 */
export async function getQueueCount(): Promise<number> {
  const now = new Date();
  const [reviewRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.needsReview, true));
  const [dueRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(followups)
    .where(and(isNull(followups.completedAt), lte(followups.dueAt, now)));
  return (reviewRow?.c ?? 0) + (dueRow?.c ?? 0);
}
