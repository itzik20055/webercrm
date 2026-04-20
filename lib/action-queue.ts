import "server-only";
import { db, leads, followups, interactions } from "@/db";
import { and, asc, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";

export type ActionKind =
  | "overdue_followup"
  | "due_now_followup"
  | "today_followup"
  | "hot_stale"
  | "quoted_no_reply"
  | "new_uncontacted";

export type ActionUrgency = "now" | "today" | "soon";

export type Action = {
  key: string;
  kind: ActionKind;
  urgency: ActionUrgency;
  leadId: string;
  leadName: string;
  leadPhone: string;
  leadStatus: "new" | "contacted" | "interested" | "quoted" | "closing" | "booked" | "lost";
  leadAudience: "israeli_haredi" | "american_haredi" | "european_haredi";
  leadPriority: "hot" | "warm" | "cold";
  followupId?: string;
  reason: string;
  detail?: string;
  sortRank: number;
  sortDue?: Date;
};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function relativeOverdue(due: Date, now: Date): string {
  const diffMs = now.getTime() - due.getTime();
  const days = Math.floor(diffMs / DAY);
  const hours = Math.floor((diffMs % DAY) / HOUR);
  if (days >= 1) return `באיחור ${days} ימים`;
  if (hours >= 1) return `באיחור ${hours} שעות`;
  return "באיחור";
}

function relativeUpcoming(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime();
  const hours = Math.floor(diffMs / HOUR);
  if (hours <= 0) return "עכשיו";
  if (hours === 1) return "בעוד שעה";
  if (hours < 8) return `בעוד ${hours} שעות`;
  const time = due.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `היום ${time}`;
}

export async function computeActionQueue(): Promise<{
  now: Action[];
  today: Action[];
  soon: Action[];
}> {
  const at = new Date();
  const inTwoHours = new Date(at.getTime() + 2 * HOUR);
  const endOfDay = new Date(at);
  endOfDay.setHours(23, 59, 59, 999);
  const sanityFloor = new Date(at.getTime() - 30 * DAY);
  const threeDaysAgo = new Date(at.getTime() - 3 * DAY);
  const oneDayAgo = new Date(at.getTime() - DAY);
  const twoHoursAgo = new Date(at.getTime() - 2 * HOUR);

  const [openFollowups, hotLeads, newLeads, quotedLeads] = await Promise.all([
    db
      .select({
        id: followups.id,
        leadId: followups.leadId,
        dueAt: followups.dueAt,
        reason: followups.reason,
        leadName: leads.name,
        leadPhone: leads.phone,
        leadStatus: leads.status,
        leadAudience: leads.audience,
        leadPriority: leads.priority,
      })
      .from(followups)
      .innerJoin(leads, eq(followups.leadId, leads.id))
      .where(
        and(
          isNull(followups.completedAt),
          lte(followups.dueAt, endOfDay),
          sql`${followups.dueAt} >= ${sanityFloor}`,
          ne(leads.status, "booked"),
          ne(leads.status, "lost")
        )
      )
      .orderBy(asc(followups.dueAt))
      .limit(50),
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        status: leads.status,
        audience: leads.audience,
        priority: leads.priority,
        updatedAt: leads.updatedAt,
        nextFollowupAt: leads.nextFollowupAt,
        lastInteractionAt: sql<Date | null>`(select max(${interactions.occurredAt}) from ${interactions} where ${interactions.leadId} = ${leads.id})`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.priority, "hot"),
          ne(leads.status, "booked"),
          ne(leads.status, "lost")
        )
      )
      .orderBy(desc(leads.updatedAt))
      .limit(20),
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        status: leads.status,
        audience: leads.audience,
        priority: leads.priority,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .where(and(eq(leads.status, "new"), lte(leads.createdAt, twoHoursAgo)))
      .orderBy(asc(leads.createdAt))
      .limit(15),
    db
      .select({
        id: leads.id,
        name: leads.name,
        phone: leads.phone,
        status: leads.status,
        audience: leads.audience,
        priority: leads.priority,
        updatedAt: leads.updatedAt,
        nextFollowupAt: leads.nextFollowupAt,
        lastIn: sql<Date | null>`(select max(${interactions.occurredAt}) from ${interactions} where ${interactions.leadId} = ${leads.id} and ${interactions.direction} = 'in')`,
        lastOut: sql<Date | null>`(select max(${interactions.occurredAt}) from ${interactions} where ${interactions.leadId} = ${leads.id} and ${interactions.direction} = 'out')`,
      })
      .from(leads)
      .where(
        and(
          or(eq(leads.status, "quoted"), eq(leads.status, "closing")),
          isNull(leads.nextFollowupAt),
          lte(leads.updatedAt, oneDayAgo)
        )
      )
      .orderBy(desc(leads.updatedAt))
      .limit(15),
  ]);

  const seenLeadIds = new Set<string>();
  const out: Action[] = [];

  for (const f of openFollowups) {
    const due = new Date(f.dueAt);
    const isOverdue = due < at;
    const isDueNow = !isOverdue && due <= inTwoHours;
    let kind: ActionKind = "today_followup";
    let urgency: ActionUrgency = "today";
    let detail = relativeUpcoming(due, at);
    let rank = 30;
    if (isOverdue) {
      kind = "overdue_followup";
      urgency = "now";
      detail = relativeOverdue(due, at);
      rank = 10 - Math.min(9, Math.floor((at.getTime() - due.getTime()) / DAY));
    } else if (isDueNow) {
      kind = "due_now_followup";
      urgency = "now";
      rank = 20;
    }
    out.push({
      key: `f-${f.id}`,
      kind,
      urgency,
      leadId: f.leadId,
      leadName: f.leadName,
      leadPhone: f.leadPhone,
      leadStatus: f.leadStatus,
      leadAudience: f.leadAudience,
      leadPriority: f.leadPriority,
      followupId: f.id,
      reason: f.reason ?? "פולואפ",
      detail,
      sortRank: rank,
      sortDue: due,
    });
    seenLeadIds.add(f.leadId);
  }

  for (const l of hotLeads) {
    if (seenLeadIds.has(l.id)) continue;
    const last = l.lastInteractionAt ? new Date(l.lastInteractionAt) : null;
    const stale = !last || last < threeDaysAgo;
    if (!stale) continue;
    if (l.nextFollowupAt && new Date(l.nextFollowupAt) > endOfDay) continue;
    const days = last
      ? Math.floor((at.getTime() - last.getTime()) / DAY)
      : null;
    out.push({
      key: `h-${l.id}`,
      kind: "hot_stale",
      urgency: "today",
      leadId: l.id,
      leadName: l.name,
      leadPhone: l.phone,
      leadStatus: l.status,
      leadAudience: l.audience,
      leadPriority: l.priority,
      reason: "ליד חם — לא בקשר",
      detail: days != null ? `${days} ימים מאז שדיברתם` : "אין תיעוד שיחה",
      sortRank: 50,
    });
    seenLeadIds.add(l.id);
  }

  for (const q of quotedLeads) {
    if (seenLeadIds.has(q.id)) continue;
    const lastIn = q.lastIn ? new Date(q.lastIn) : null;
    const lastOut = q.lastOut ? new Date(q.lastOut) : null;
    if (lastIn && lastOut && lastIn > lastOut) continue;
    out.push({
      key: `q-${q.id}`,
      kind: "quoted_no_reply",
      urgency: "soon",
      leadId: q.id,
      leadName: q.name,
      leadPhone: q.phone,
      leadStatus: q.status,
      leadAudience: q.audience,
      leadPriority: q.priority,
      reason: q.status === "closing" ? "בסגירה — בלי תגובה" : "קיבל הצעה — בלי תגובה",
      detail: "קבע פולואפ לפני שיתקרר",
      sortRank: 60,
    });
    seenLeadIds.add(q.id);
  }

  for (const n of newLeads) {
    if (seenLeadIds.has(n.id)) continue;
    const ageHours = Math.floor((at.getTime() - new Date(n.createdAt).getTime()) / HOUR);
    out.push({
      key: `n-${n.id}`,
      kind: "new_uncontacted",
      urgency: ageHours > 24 ? "today" : "soon",
      leadId: n.id,
      leadName: n.name,
      leadPhone: n.phone,
      leadStatus: n.status,
      leadAudience: n.audience,
      leadPriority: n.priority,
      reason: "ליד חדש שלא נוצר קשר",
      detail: ageHours > 24 ? `נכנס לפני ${Math.floor(ageHours / 24)} ימים` : `נכנס לפני ${ageHours} שעות`,
      sortRank: ageHours > 24 ? 55 : 70,
    });
    seenLeadIds.add(n.id);
  }

  out.sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    const da = a.sortDue?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = b.sortDue?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  return {
    now: out.filter((a) => a.urgency === "now"),
    today: out.filter((a) => a.urgency === "today"),
    soon: out.filter((a) => a.urgency === "soon"),
  };
}
