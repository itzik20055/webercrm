import "server-only";
import { db, leads, followups } from "@/db";
import { and, asc, count, eq, isNull, lt, lte, ne, sql } from "drizzle-orm";

const DAY_MS = 24 * 60 * 60 * 1000;

export type Briefing = {
  title: string;
  body: string;
  todayCount: number;
  overdueCount: number;
  hotCount: number;
  previewNames: string[];
  isEmpty: boolean;
};

export async function computeMorningBriefing(at: Date = new Date()): Promise<Briefing> {
  const horizon = new Date(at.getTime() + 18 * 60 * 60 * 1000);
  const sanityFloor = new Date(at.getTime() - 14 * DAY_MS);

  const [todayRows, overdueRows, hotRow, hotNameRows] = await Promise.all([
    db
      .select({ leadName: leads.name })
      .from(followups)
      .innerJoin(leads, eq(followups.leadId, leads.id))
      .where(
        and(
          isNull(followups.completedAt),
          lte(followups.dueAt, horizon),
          sql`${followups.dueAt} >= ${at}`,
          ne(leads.status, "booked"),
          ne(leads.status, "lost")
        )
      )
      .orderBy(asc(followups.dueAt))
      .limit(20),
    db
      .select({ leadName: leads.name })
      .from(followups)
      .innerJoin(leads, eq(followups.leadId, leads.id))
      .where(
        and(
          isNull(followups.completedAt),
          lt(followups.dueAt, at),
          sql`${followups.dueAt} >= ${sanityFloor}`,
          ne(leads.status, "booked"),
          ne(leads.status, "lost")
        )
      )
      .orderBy(asc(followups.dueAt))
      .limit(20),
    db
      .select({ c: count() })
      .from(leads)
      .where(
        and(
          eq(leads.priority, "hot"),
          ne(leads.status, "booked"),
          ne(leads.status, "lost")
        )
      ),
    db
      .select({ name: leads.name })
      .from(leads)
      .where(
        and(
          eq(leads.priority, "hot"),
          ne(leads.status, "booked"),
          ne(leads.status, "lost")
        )
      )
      .orderBy(sql`${leads.updatedAt} desc`)
      .limit(3),
  ]);

  const todayCount = todayRows.length;
  const overdueCount = overdueRows.length;
  const hotCount = Number(hotRow[0]?.c ?? 0);

  const isEmpty = todayCount === 0 && overdueCount === 0 && hotCount === 0;

  const followupNames = [
    ...overdueRows.map((r) => r.leadName),
    ...todayRows.map((r) => r.leadName),
  ];
  const nameSource =
    followupNames.length > 0 ? followupNames : hotNameRows.map((r) => r.name);
  const previewNames = Array.from(new Set(nameSource)).slice(0, 3);

  const titleParts: string[] = [];
  if (overdueCount > 0) titleParts.push(`${overdueCount} באיחור`);
  if (todayCount > 0) titleParts.push(`${todayCount} היום`);
  if (titleParts.length === 0 && hotCount > 0) titleParts.push(`${hotCount} חמים`);

  const title = isEmpty
    ? "סוף שבוע שקט"
    : `בוקר טוב — ${titleParts.join(" · ")}`;

  const bodyParts: string[] = [];
  if (previewNames.length > 0) bodyParts.push(previewNames.join(", "));
  if (hotCount > 0 && !titleParts.includes(`${hotCount} חמים`)) {
    bodyParts.push(`${hotCount} לידים חמים פתוחים`);
  }
  const body =
    bodyParts.join(" · ") ||
    (isEmpty
      ? "אין פולואפים פתוחים — יום פנוי לחיפוש לידים"
      : "אין פולואפים פתוחים — בדוק את הלידים החמים");

  return { title, body, todayCount, overdueCount, hotCount, previewNames, isEmpty };
}
