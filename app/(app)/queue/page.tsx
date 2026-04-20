import Link from "next/link";
import {
  Phone,
  MessageCircle,
  AlertTriangle,
  Sun,
  Moon,
  CheckCircle2,
  Sparkles,
  ChevronLeft,
  Trash2,
  X,
  BellRing,
} from "lucide-react";
import { db, leads, followups, type Lead } from "@/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { StatusBadge } from "@/components/status-badge";
import { ResolveFollowupButton } from "@/components/resolve-followup";
import {
  fullDate,
  relativeTime,
  telLink,
  whatsappLink,
} from "@/lib/format";
import { localTimeLabel, isGoodTimeToCall } from "@/lib/audience-tz";
import { AUDIENCE_LABELS } from "@/db/schema";
import {
  rejectPendingExtraction,
  deleteLeadFromInbox,
  type PendingExtraction,
} from "../inbox/actions";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const [reviewLeads, openFollowups] = await Promise.all([
    db
      .select()
      .from(leads)
      .where(eq(leads.needsReview, true))
      .orderBy(desc(leads.updatedAt))
      .limit(50),
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
      .where(isNull(followups.completedAt))
      .orderBy(asc(followups.dueAt)),
  ]);

  const now = new Date();
  const overdue = openFollowups.filter((r) => new Date(r.dueAt) < now);
  const today = openFollowups.filter((r) => {
    const d = new Date(r.dueAt);
    return (
      d >= now &&
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  });
  const upcoming = openFollowups.filter(
    (r) => !overdue.includes(r) && !today.includes(r)
  );

  const total =
    reviewLeads.length + overdue.length + today.length + upcoming.length;

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground tracking-tight flex items-center gap-1.5">
            <BellRing className="size-3.5" />
            תור פעולה
          </p>
          <h1 className="text-[26px] font-bold tracking-tight leading-tight">
            מה לעשות עכשיו
          </h1>
        </div>
        {total > 0 && (
          <span className="text-xs font-semibold text-muted-foreground tabular-nums shrink-0">
            {total} פתוחים
          </span>
        )}
      </header>

      {total === 0 && (
        <div className="rounded-2xl bg-card border border-dashed border-border/70 p-6 text-center space-y-2">
          <CheckCircle2
            className="size-8 text-emerald-500 mx-auto"
            strokeWidth={1.8}
          />
          <p className="font-semibold tracking-tight">כל הכבוד</p>
          <p className="text-sm text-muted-foreground">
            התור ריק. אין לידים לאישור או פולואפים פתוחים.
          </p>
        </div>
      )}

      {overdue.length > 0 && (
        <Group title="באיחור" tone="destructive" count={overdue.length}>
          {overdue.map((r) => (
            <FollowupRow
              key={r.id}
              row={r}
              overdue
              hasOtherOpen={openFollowups.some(
                (x) => x.leadId === r.leadId && x.id !== r.id
              )}
            />
          ))}
        </Group>
      )}

      {reviewLeads.length > 0 && (
        <Group title="לאישור" tone="primary" count={reviewLeads.length}>
          {reviewLeads.map((l) => (
            <ReviewCard
              key={l.id}
              lead={l}
              pending={l.pendingExtraction as PendingExtraction | null}
            />
          ))}
        </Group>
      )}

      {today.length > 0 && (
        <Group title="היום" count={today.length}>
          {today.map((r) => (
            <FollowupRow
              key={r.id}
              row={r}
              hasOtherOpen={openFollowups.some(
                (x) => x.leadId === r.leadId && x.id !== r.id
              )}
            />
          ))}
        </Group>
      )}

      {upcoming.length > 0 && (
        <Group title="הבא בתור" count={upcoming.length}>
          {upcoming.map((r) => (
            <FollowupRow
              key={r.id}
              row={r}
              hasOtherOpen={openFollowups.some(
                (x) => x.leadId === r.leadId && x.id !== r.id
              )}
            />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({
  title,
  tone = "default",
  count,
  children,
}: {
  title: string;
  tone?: "default" | "destructive" | "primary";
  count: number;
  children: React.ReactNode;
}) {
  const titleClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "primary"
        ? "text-primary"
        : "text-foreground";
  const dotClass =
    tone === "destructive"
      ? "bg-destructive"
      : tone === "primary"
        ? "bg-primary"
        : "bg-muted-foreground/40";
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-1.5 px-1">
        {tone === "destructive" ? (
          <AlertTriangle
            className="size-4 text-destructive shrink-0"
            strokeWidth={2.4}
            aria-hidden="true"
          />
        ) : (
          <span
            className={"size-1.5 rounded-full shrink-0 " + dotClass}
            aria-hidden="true"
          />
        )}
        <h2 className={"text-[13px] font-bold tracking-tight " + titleClass}>
          {title}
        </h2>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
          {count}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ReviewCard({
  lead,
  pending,
}: {
  lead: Lead;
  pending: PendingExtraction | null;
}) {
  const reject = rejectPendingExtraction.bind(null, lead.id);
  const del = deleteLeadFromInbox.bind(null, lead.id);
  const summary = pending?.summary?.trim();

  return (
    <article className="bg-card border border-border/70 rounded-2xl shadow-soft overflow-hidden">
      <Link
        href={`/inbox/${lead.id}`}
        className="press block p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`פתח לאישור: ${lead.name}`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight truncate">
                {lead.name}
              </span>
              {pending && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
                  <Sparkles className="size-2.5" />
                  AI
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span dir="ltr">{lead.phone}</span>
              <span>·</span>
              <span>{relativeTime(lead.updatedAt)}</span>
            </div>
            {summary ? (
              <p className="text-sm text-foreground/85 line-clamp-2 leading-snug pt-0.5">
                {summary}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic pt-0.5">
                אין סיכום — תמלול נכשל או היה ריק.
              </p>
            )}
          </div>
          <ChevronLeft className="size-5 text-muted-foreground shrink-0 mt-1" />
        </div>
      </Link>

      <div className="border-t border-border/60 bg-muted/30 px-2 py-1.5 flex items-center gap-1">
        <a
          href={telLink(lead.phone)}
          className="press size-11 rounded-full text-primary flex items-center justify-center hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`חייג ל${lead.name}`}
        >
          <Phone className="size-[18px]" strokeWidth={2.2} />
        </a>
        <a
          href={whatsappLink(lead.phone)}
          target="_blank"
          rel="noreferrer"
          className="press size-11 rounded-full text-emerald-700 dark:text-emerald-300 flex items-center justify-center hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={`וואטסאפ ל${lead.name}`}
        >
          <MessageCircle className="size-[18px]" strokeWidth={2.2} />
        </a>
        <div className="flex-1" />
        <form action={reject}>
          <button
            type="submit"
            className="press h-11 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`דלג על ${lead.name}`}
          >
            <X className="size-4" strokeWidth={2.2} />
            דלג
          </button>
        </form>
        <form action={del}>
          <button
            type="submit"
            className="press size-11 rounded-full text-destructive hover:bg-destructive/10 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            aria-label={`מחק את ${lead.name}`}
          >
            <Trash2 className="size-4" strokeWidth={2.2} />
          </button>
        </form>
      </div>
    </article>
  );
}

type FollowupRowData = {
  id: string;
  leadId: string;
  dueAt: Date;
  reason: string | null;
  leadName: string;
  leadPhone: string;
  leadStatus: Lead["status"];
  leadAudience: Lead["audience"];
};

function FollowupRow({
  row,
  overdue,
  hasOtherOpen,
}: {
  row: FollowupRowData;
  overdue?: boolean;
  hasOtherOpen?: boolean;
}) {
  const goodTime = isGoodTimeToCall(row.leadAudience);
  return (
    <div className="bg-card border border-border/70 rounded-2xl p-3.5 space-y-3 shadow-soft">
      <Link
        href={`/leads/${row.leadId}`}
        className="press min-w-0 flex-1 block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-tight">{row.leadName}</span>
          <StatusBadge status={row.leadStatus} />
        </div>
        <div
          className={
            "text-sm mt-1 flex items-center gap-1 " +
            (overdue
              ? "text-destructive font-semibold"
              : "text-muted-foreground font-medium")
          }
        >
          {overdue && (
            <AlertTriangle
              className="size-3.5 shrink-0"
              strokeWidth={2.4}
              aria-label="באיחור"
            />
          )}
          {fullDate(row.dueAt)}
        </div>
        {row.reason && (
          <p className="text-sm mt-1.5 text-foreground/90">{row.reason}</p>
        )}
        <div className="text-[11px] font-medium text-muted-foreground mt-1.5 flex items-center gap-1 flex-wrap">
          {goodTime ? (
            <Sun className="size-3 text-amber-500" aria-hidden="true" />
          ) : (
            <Moon className="size-3 text-muted-foreground" aria-hidden="true" />
          )}
          <span>
            {localTimeLabel(row.leadAudience)} · {AUDIENCE_LABELS[row.leadAudience]}
          </span>
          {!goodTime && (
            <span className="text-amber-600 font-semibold">
              · לא זמן טוב לחיוג
            </span>
          )}
        </div>
      </Link>
      <div className="flex gap-2">
        <a
          href={telLink(row.leadPhone)}
          className="press flex-1 h-11 rounded-full bg-primary-soft text-primary text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`חייג ל${row.leadName}`}
        >
          <Phone className="size-[16px]" strokeWidth={2.2} />
          חייג
        </a>
        <a
          href={whatsappLink(row.leadPhone)}
          target="_blank"
          rel="noreferrer"
          className="press flex-1 h-11 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label={`וואטסאפ ל${row.leadName}`}
        >
          <MessageCircle className="size-[16px]" strokeWidth={2.2} />
          וואטסאפ
        </a>
        <ResolveFollowupButton
          followupId={row.id}
          leadId={row.leadId}
          label="בוצע"
          hasOtherOpen={hasOtherOpen}
        />
      </div>
    </div>
  );
}

