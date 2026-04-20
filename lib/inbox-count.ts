import { db, leads } from "@/db";
import { eq, sql } from "drizzle-orm";

export async function getInboxCount(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.needsReview, true));
  return row?.c ?? 0;
}
