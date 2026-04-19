import Link from "next/link";
import { db, leads, followups } from "@/db";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import {
  Plus,
  BellRing,
  Flame,
  Sparkles,
  ChevronLeft,
  Phone,
  MessageCircle,
  TrendingUp,
  PartyPopper,
} from "lucide-react";
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

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "בוקר טוב";
  if (h < 18) return "צהריים טובים";
  if (h < 22) return "ערב טוב";
  return "לילה טוב";
};

export default async function HomePage() {
  const { todaysFollowups, hot, recent, counts } = await getDashboard();
  const overdueCount = todaysFollowups.filter(
    (f) => new Date(f.dueAt) < new Date()
  ).length;

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground tracking-tight">
            {greeting()}
          </p>
          <h1 className="text-[26px] font-bold tracking-tight leading-tight">
            איציק
          </h1>
        </div>
        <Link
          href="/leads/new"
          className="press inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-card"
        >
          <Plus className="size-[18px]" strokeWidth={2.5} />
          ליד חדש
        </Link>
      </header>

      <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#1e3a8a] via-[#152a6b] to-[#0c1e6f] text-white p-5 shadow-card">
        <div className="absolute -top-16 -left-10 size-44 rounded-full bg-white/8 blur-2xl" />
        <div className="absolute -bottom-20 -right-10 size-52 rounded-full bg-[#f4d77c]/25 blur-3xl" />
        <div className="absolute bottom-3 right-4 left-4 h-px bg-gradient-to-r from-transparent via-[#f4d77c]/40 to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70">
            <TrendingUp className="size-3.5" />
            סטטיסטיקה
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="פעילים" value={counts.active} />
            <Stat label="סגורים" value={counts.booked} accent />
            <Stat label="באיחור" value={counts.overdue} warn={counts.overdue > 0} />
          </div>
        </div>
      </div>

      <Section
        title="פולואפים להיום"
        icon={<BellRing className="size-[18px] text-primary" />}
        href="/followups"
        badge={
          todaysFollowups.length > 0
            ? {
                text: `${todaysFollowups.length}${overdueCount > 0 ? ` · ${overdueCount} באיחור` : ""}`,
                tone: overdueCount > 0 ? "destructive" : "default",
              }
            : undefined
        }
      >
        {todaysFollowups.length === 0 ? (
          <EmptyRow icon={<PartyPopper className="size-4" />} text="אין פולואפים להיום" />
        ) : (
          todaysFollowups.slice(0, 5).map((f) => {
            const overdue = new Date(f.dueAt) < new Date();
            const goodTime = isGoodTimeToCall(f.leadAudience);
            return (
              <div
                key={f.id}
                className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-card border border-border/70 shadow-soft"
              >
                <Link
                  href={`/leads/${f.leadId}`}
                  className="min-w-0 flex-1 press"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate tracking-tight">
                      {f.leadName}
                    </span>
                    <StatusBadge status={f.leadStatus} />
                  </div>
                  {f.reason && (
                    <p className="text-sm text-muted-foreground mt-1 truncate">
                      {f.reason}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                    <span className={overdue ? "text-destructive font-semibold" : "font-medium"}>
                      {smartDate(f.dueAt)}
                    </span>
                    <span className="opacity-50">·</span>
                    <span className={goodTime ? "" : "text-amber-600 font-medium"}>
                      {localTimeLabel(f.leadAudience)} {AUDIENCE_LABELS[f.leadAudience].split(" ")[1]}
                    </span>
                  </div>
                </Link>
                <div className="flex gap-1.5 shrink-0">
                  <a
                    href={telLink(f.leadPhone)}
                    className="press size-10 rounded-full bg-primary-soft text-primary flex items-center justify-center"
                    aria-label="חייג"
                  >
                    <Phone className="size-[18px]" strokeWidth={2.2} />
                  </a>
                  <a
                    href={whatsappLink(f.leadPhone)}
                    target="_blank"
                    rel="noreferrer"
                    className="press size-10 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"
                    aria-label="וואטסאפ"
                  >
                    <MessageCircle className="size-[18px]" strokeWidth={2.2} />
                  </a>
                </div>
              </div>
            );
          })
        )}
      </Section>

      <Section
        title="לידים חמים"
        icon={<Flame className="size-[18px] text-red-500" />}
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
        icon={<Sparkles className="size-[18px] text-blue-500" />}
        href="/leads"
      >
        {recent.length === 0 ? (
          <EmptyRow text="עדיין לא נכנסו לידים — הוסף את הראשון" />
        ) : (
          recent.slice(0, 4).map((l) => <LeadRow key={l.id} lead={l} />)
        )}
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: number;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div>
      <div
        className={
          "text-[28px] font-bold leading-none tracking-tight tabular-nums " +
          (accent ? "text-[#f4d77c]" : warn ? "text-amber-200" : "text-white")
        }
      >
        {value}
      </div>
      <div className="text-[11px] font-medium text-white/70 mt-1 tracking-tight">
        {label}
      </div>
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
          <h2 className="font-bold tracking-tight">{title}</h2>
          {badge && (
            <span
              className={
                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold " +
                (badge.tone === "destructive"
                  ? "bg-destructive/12 text-destructive"
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
            className="press text-xs font-semibold text-muted-foreground flex items-center"
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

function EmptyRow({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="text-sm text-muted-foreground py-5 px-3 text-center bg-card/60 border border-dashed border-border/80 rounded-2xl flex items-center justify-center gap-2">
      {icon}
      {text}
    </div>
  );
}

function LeadRow({ lead }: { lead: typeof leads.$inferSelect }) {
  return (
    <Link
      href={`/leads/${lead.id}`}
      className="press flex items-center justify-between p-3.5 rounded-2xl bg-card border border-border/70 shadow-soft"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate tracking-tight">{lead.name}</span>
          <StatusBadge status={lead.status} />
        </div>
        <div className="text-xs text-muted-foreground mt-1 tabular-nums">
          {smartDate(lead.updatedAt)} · {lead.phone}
        </div>
      </div>
      <ChevronLeft className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
