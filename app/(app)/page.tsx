import Link from "next/link";
import { db, leads, followups } from "@/db";
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { Plus, BellRing, Flame, Sparkles, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { smartDate, telLink, whatsappLink } from "@/lib/format";
import { localTimeLabel, isGoodTimeToCall } from "@/lib/audience-tz";
import { AUDIENCE_LABELS } from "@/db/schema";

export const dynamic = "force-dynamic";

async function getDashboard() {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [todaysFollowups, hot, recent, counts] = await Promise.all([
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
      })
      .from(followups)
      .innerJoin(leads, eq(followups.leadId, leads.id))
      .where(and(isNull(followups.completedAt), lte(followups.dueAt, endOfDay)))
      .orderBy(asc(followups.dueAt))
      .limit(20),
    db
      .select()
      .from(leads)
      .where(and(eq(leads.priority, "hot"), sql`${leads.status} not in ('booked','lost')`))
      .orderBy(desc(leads.updatedAt))
      .limit(10),
    db
      .select()
      .from(leads)
      .where(gte(leads.createdAt, weekAgo))
      .orderBy(desc(leads.createdAt))
      .limit(10),
    db
      .select({
        total: sql<number>`count(*)::int`,
        booked: sql<number>`count(*) filter (where ${leads.status} = 'booked')::int`,
        active: sql<number>`count(*) filter (where ${leads.status} not in ('booked','lost'))::int`,
        overdue: sql<number>`count(*) filter (where ${leads.nextFollowupAt} < now() and ${leads.followupCompletedAt} is null)::int`,
      })
      .from(leads),
  ]);

  return { todaysFollowups, hot, recent, counts: counts[0] };
}

export default async function HomePage() {
  const { todaysFollowups, hot, recent, counts } = await getDashboard();
  const overdueCount = todaysFollowups.filter(
    (f) => new Date(f.dueAt) < new Date()
  ).length;

  return (
    <div className="px-4 pt-6 pb-4 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">שלום איציק 👋</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {counts.active} לידים פעילים · {counts.booked} סגורים העונה
          </p>
        </div>
        <Button asChild size="lg" className="rounded-full shadow-md">
          <Link href="/leads/new">
            <Plus className="size-5" />
            ליד חדש
          </Link>
        </Button>
      </header>

      <Section
        title="פולואפים להיום"
        icon={<BellRing className="size-4" />}
        href="/followups"
        badge={
          todaysFollowups.length > 0
            ? {
                text: `${todaysFollowups.length}${overdueCount > 0 ? ` (${overdueCount} באיחור)` : ""}`,
                tone: overdueCount > 0 ? "destructive" : "default",
              }
            : undefined
        }
      >
        {todaysFollowups.length === 0 ? (
          <EmptyRow text="אין פולואפים להיום 🎉" />
        ) : (
          todaysFollowups.slice(0, 5).map((f) => {
            const overdue = new Date(f.dueAt) < new Date();
            const goodTime = isGoodTimeToCall(f.leadAudience);
            return (
              <Link
                key={f.id}
                href={`/leads/${f.leadId}`}
                className="block p-3 rounded-lg bg-card border hover:bg-accent transition active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{f.leadName}</span>
                      <StatusBadge status={f.leadStatus} />
                    </div>
                    {f.reason && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {f.reason}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className={overdue ? "text-destructive font-medium" : ""}>
                        {smartDate(f.dueAt)}
                      </span>
                      <span>·</span>
                      <span className={goodTime ? "" : "text-amber-600"}>
                        {localTimeLabel(f.leadAudience)} {AUDIENCE_LABELS[f.leadAudience].split(" ")[1]}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <a
                      href={telLink(f.leadPhone)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"
                      aria-label="חייג"
                    >
                      📞
                    </a>
                    <a
                      href={whatsappLink(f.leadPhone)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="size-9 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center"
                      aria-label="וואטסאפ"
                    >
                      💬
                    </a>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </Section>

      <Section
        title="לידים חמים"
        icon={<Flame className="size-4 text-red-500" />}
        href="/leads?priority=hot"
      >
        {hot.length === 0 ? (
          <EmptyRow text="אין לידים מסומנים כחמים" />
        ) : (
          hot.slice(0, 4).map((l) => (
            <LeadRow key={l.id} lead={l} />
          ))
        )}
      </Section>

      <Section
        title="חדשים השבוע"
        icon={<Sparkles className="size-4 text-blue-500" />}
        href="/leads"
      >
        {recent.length === 0 ? (
          <EmptyRow text="עדיין לא נכנסו לידים — לך תוסיף את הראשון!" />
        ) : (
          recent.slice(0, 4).map((l) => <LeadRow key={l.id} lead={l} />)
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  href,
  badge,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  href?: string;
  badge?: { text: string; tone: "default" | "destructive" };
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold">{title}</h2>
          {badge && (
            <span
              className={
                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium " +
                (badge.tone === "destructive"
                  ? "bg-destructive/15 text-destructive"
                  : "bg-secondary text-secondary-foreground")
              }
            >
              {badge.text}
            </span>
          )}
        </div>
        {href && (
          <Link
            href={href}
            className="text-xs text-muted-foreground flex items-center"
          >
            הכל
            <ChevronLeft className="size-3.5" />
          </Link>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="text-sm text-muted-foreground py-4 px-3 text-center bg-card border border-dashed rounded-lg">
      {text}
    </div>
  );
}

function LeadRow({ lead }: { lead: typeof leads.$inferSelect }) {
  return (
    <Link
      href={`/leads/${lead.id}`}
      className="flex items-center justify-between p-3 rounded-lg bg-card border hover:bg-accent transition active:scale-[0.99]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{lead.name}</span>
          <StatusBadge status={lead.status} />
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {smartDate(lead.updatedAt)} · {lead.phone}
        </div>
      </div>
      <ChevronLeft className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
