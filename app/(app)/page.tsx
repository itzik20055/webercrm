import { Suspense } from "react";
import Link from "next/link";
import { db, leads } from "@/db";
import { sql } from "drizzle-orm";
import {
  Plus,
  ChevronLeft,
  Phone,
  MessageCircle,
  TrendingUp,
  PartyPopper,
  Zap,
  Clock,
  CalendarDays,
  Inbox,
  Flame,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { telLink, whatsappLink } from "@/lib/format";
import { localTimeLabel, isGoodTimeToCall } from "@/lib/audience-tz";
import { computeActionQueue, type Action } from "@/lib/action-queue";
import { getInboxCount } from "@/lib/queue-count";
import { AUDIENCE_LABELS } from "@/db/schema";

export const dynamic = "force-dynamic";

async function getStats() {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${leads.status} not in ('booked','lost'))::int`,
      hot: sql<number>`count(*) filter (where ${leads.priority} = 'hot' and ${leads.status} not in ('booked','lost'))::int`,
      booked: sql<number>`count(*) filter (where ${leads.status} = 'booked')::int`,
    })
    .from(leads);
  return row;
}

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "בוקר טוב";
  if (h < 18) return "צהריים טובים";
  if (h < 22) return "ערב טוב";
  return "לילה טוב";
};

export default function HomePage() {
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

      <Suspense fallback={<StatsSkeleton />}>
        <StatsSection />
      </Suspense>

      <Suspense fallback={null}>
        <InboxBannerSection />
      </Suspense>

      <Suspense fallback={<ActionQueueSkeleton />}>
        <ActionQueueSection />
      </Suspense>
    </div>
  );
}

async function StatsSection() {
  const counts = await getStats();
  return (
    <div className="relative overflow-hidden rounded-[22px] bg-[#111e2f] text-white p-5 shadow-card">
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
          <Stat
            label="חמים"
            value={counts.hot}
            warn={counts.hot > 0}
            icon={counts.hot > 0 ? <Flame className="size-3.5" strokeWidth={2.4} /> : null}
          />
          <Stat label="סגורים" value={counts.booked} accent />
        </div>
      </div>
    </div>
  );
}

async function InboxBannerSection() {
  const inboxCount = await getInboxCount().catch(() => 0);
  if (inboxCount === 0) return null;
  return (
    <Link
      href="/inbox"
      className="press flex items-center gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 shadow-soft"
    >
      <div className="size-11 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
        <Inbox className="size-5" strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold tracking-tight">
          {inboxCount} {inboxCount === 1 ? "פריט" : "פריטים"} מחכים לאישור
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          הקלטות שיחה ולידים לסקירה
        </div>
      </div>
      <ChevronLeft className="size-5 text-muted-foreground shrink-0" />
    </Link>
  );
}

async function ActionQueueSection() {
  const queue = await computeActionQueue();
  const total = queue.now.length + queue.today.length + queue.soon.length;
  if (total === 0) return <EmptyAll />;
  return (
    <>
      {queue.now.length > 0 && (
        <ActionSection
          title="עכשיו"
          icon={<Zap className="size-[18px] text-destructive" strokeWidth={2.4} />}
          count={queue.now.length}
          tone="now"
          actions={queue.now}
        />
      )}
      {queue.today.length > 0 && (
        <ActionSection
          title="היום"
          icon={<Clock className="size-[18px] text-amber-500" strokeWidth={2.2} />}
          count={queue.today.length}
          tone="today"
          actions={queue.today}
        />
      )}
      {queue.soon.length > 0 && (
        <ActionSection
          title="בקרוב"
          icon={<CalendarDays className="size-[18px] text-muted-foreground" strokeWidth={2.2} />}
          count={queue.soon.length}
          tone="soon"
          actions={queue.soon}
        />
      )}
    </>
  );
}

function StatsSkeleton() {
  return (
    <div className="h-[128px] rounded-[22px] bg-[#111e2f]/80 animate-pulse" />
  );
}

function ActionQueueSkeleton() {
  return (
    <div className="space-y-2.5">
      <div className="h-5 w-20 rounded-full bg-muted/25 animate-pulse" />
      <div className="h-[92px] rounded-2xl bg-muted/20 animate-pulse" />
      <div className="h-[92px] rounded-2xl bg-muted/20 animate-pulse" />
      <div className="h-[92px] rounded-2xl bg-muted/20 animate-pulse" />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  warn,
  icon,
}: {
  label: string;
  value: number;
  accent?: boolean;
  warn?: boolean;
  icon?: React.ReactNode;
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
      <div className="text-[11px] font-medium text-white/70 mt-1 tracking-tight flex items-center gap-1">
        {icon}
        {label}
      </div>
    </div>
  );
}

function ActionSection({
  title,
  icon,
  count,
  tone,
  actions,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  tone: "now" | "today" | "soon";
  actions: Action[];
}) {
  const badgeClass =
    tone === "now"
      ? "bg-destructive/12 text-destructive"
      : tone === "today"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-secondary text-secondary-foreground";

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-bold tracking-tight">{title}</h2>
          <span
            className={
              "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums " +
              badgeClass
            }
          >
            {count}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        {actions.slice(0, 8).map((a) => (
          <ActionCard key={a.key} action={a} tone={tone} />
        ))}
        {actions.length > 8 && (
          <Link
            href={tone === "now" || tone === "today" ? "/followups" : "/leads"}
            className="press flex items-center justify-center gap-1 py-3 text-xs font-semibold text-muted-foreground"
          >
            עוד {actions.length - 8} פעולות
            <ChevronLeft className="size-3.5" />
          </Link>
        )}
      </div>
    </section>
  );
}

function ActionCard({
  action,
  tone,
}: {
  action: Action;
  tone: "now" | "today" | "soon";
}) {
  const goodTime = isGoodTimeToCall(action.leadAudience);
  const audienceShort = AUDIENCE_LABELS[action.leadAudience].split(" ")[1];
  const isOverdue = action.kind === "overdue_followup";

  const cardClass =
    tone === "now"
      ? "bg-destructive/[0.04] border-destructive/25"
      : tone === "today"
      ? "bg-card border-amber-500/20"
      : "bg-card border-border/70";

  return (
    <div
      className={
        "flex items-start gap-2.5 p-3.5 rounded-2xl border shadow-soft " +
        cardClass
      }
    >
      <Link href={`/leads/${action.leadId}`} className="press min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate tracking-tight">
            {action.leadName}
          </span>
          <StatusBadge status={action.leadStatus} />
        </div>
        <p className="text-sm font-medium mt-1 truncate">{action.reason}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          {action.detail && (
            <>
              <span
                className={
                  isOverdue
                    ? "text-destructive font-semibold"
                    : tone === "now"
                    ? "font-semibold"
                    : "font-medium"
                }
              >
                {action.detail}
              </span>
              <span className="opacity-50">·</span>
            </>
          )}
          <span className={goodTime ? "" : "text-amber-600 font-medium"}>
            {localTimeLabel(action.leadAudience)} {audienceShort}
          </span>
        </div>
      </Link>
      <div className="flex gap-1.5 shrink-0">
        <a
          href={telLink(action.leadPhone)}
          className="press size-11 rounded-full bg-primary-soft text-primary flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          aria-label={`חייג ל${action.leadName}`}
        >
          <Phone className="size-[18px]" strokeWidth={2.2} />
        </a>
        <a
          href={whatsappLink(action.leadPhone)}
          target="_blank"
          rel="noreferrer"
          className="press size-11 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          aria-label={`וואטסאפ ל${action.leadName}`}
        >
          <MessageCircle className="size-[18px]" strokeWidth={2.2} />
        </a>
      </div>
    </div>
  );
}

function EmptyAll() {
  return (
    <div className="rounded-2xl bg-card border border-dashed border-border/70 p-6 text-center space-y-2">
      <PartyPopper className="size-8 text-emerald-500 mx-auto" strokeWidth={1.8} />
      <p className="font-semibold tracking-tight">הרשימה ריקה</p>
      <p className="text-sm text-muted-foreground">
        אין פעולות דחופות — נצל את הזמן לחיפוש לידים חדשים
      </p>
      <Link
        href="/leads/new"
        className="press inline-flex items-center gap-1.5 mt-2 h-10 px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold"
      >
        <Plus className="size-4" strokeWidth={2.4} />
        הוסף ליד
      </Link>
    </div>
  );
}
