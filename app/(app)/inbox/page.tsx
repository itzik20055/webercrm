import Link from "next/link";
import { db, leads } from "@/db";
import { desc, eq } from "drizzle-orm";
import { Inbox, Phone, MessageCircle, Clock, CheckCircle2, X, Trash2 } from "lucide-react";
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  INTEREST_TAG_LABELS,
  LANGUAGE_LABELS,
  AUDIENCE_LABELS,
  type Lead,
} from "@/db/schema";
import { relativeTime, telLink, whatsappLink } from "@/lib/format";
import {
  approvePendingExtraction,
  rejectPendingExtraction,
  deleteLeadFromInbox,
  type PendingExtraction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const rows = await db
    .select()
    .from(leads)
    .where(eq(leads.needsReview, true))
    .orderBy(desc(leads.updatedAt))
    .limit(50);

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <header>
        <p className="text-xs font-medium text-muted-foreground tracking-tight flex items-center gap-1.5">
          <Inbox className="size-3.5" />
          תיבת ניקוז
        </p>
        <h1 className="text-[26px] font-bold tracking-tight leading-tight">
          לידים לאישור
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          לידים שנוצרו אוטומטית מהקלטות שיחה. אשר או דחה את הנתונים שה-AI חילץ
          לפני שהם נכנסים לכרטיס.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card border border-dashed border-border/70 p-6 text-center space-y-2">
          <CheckCircle2 className="size-8 text-emerald-500 mx-auto" strokeWidth={1.8} />
          <p className="font-semibold tracking-tight">הכול נוקה</p>
          <p className="text-sm text-muted-foreground">
            אין לידים שמחכים לאישור כרגע.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((l) => (
            <ReviewCard
              key={l.id}
              lead={l}
              pending={l.pendingExtraction as PendingExtraction | null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  lead,
  pending,
}: {
  lead: Lead;
  pending: PendingExtraction | null;
}) {
  const approve = approvePendingExtraction.bind(null, lead.id);
  const reject = rejectPendingExtraction.bind(null, lead.id);
  const del = deleteLeadFromInbox.bind(null, lead.id);

  const dueIn = pending?.suggestedFollowupHours ?? null;
  const followupLabel =
    dueIn == null
      ? null
      : dueIn < 24
        ? `בעוד ${dueIn} שעות`
        : `בעוד ${Math.round(dueIn / 24)} ימים`;

  return (
    <article className="bg-card border border-border/70 rounded-2xl p-4 space-y-3 shadow-soft">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/leads/${lead.id}`}
            className="font-semibold tracking-tight truncate block"
          >
            {lead.name}
          </Link>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span dir="ltr">{lead.phone}</span>
            <span>·</span>
            <span>{relativeTime(lead.updatedAt)}</span>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <a
            href={telLink(lead.phone)}
            className="press size-9 rounded-full bg-primary-soft text-primary flex items-center justify-center"
            aria-label="חייג"
          >
            <Phone className="size-[16px]" strokeWidth={2.2} />
          </a>
          <a
            href={whatsappLink(lead.phone)}
            target="_blank"
            rel="noreferrer"
            className="press size-9 rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"
            aria-label="וואטסאפ"
          >
            <MessageCircle className="size-[16px]" strokeWidth={2.2} />
          </a>
        </div>
      </header>

      {pending ? (
        <>
          {pending.summary && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                סיכום
              </h3>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {pending.summary}
              </p>
            </section>
          )}

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Chip>
              סטטוס:{" "}
              <strong className="font-semibold">
                {STATUS_LABELS[pending.status as keyof typeof STATUS_LABELS] ?? pending.status}
              </strong>
            </Chip>
            <Chip>
              עדיפות:{" "}
              <strong className="font-semibold">
                {PRIORITY_LABELS[pending.priority as keyof typeof PRIORITY_LABELS] ?? pending.priority}
              </strong>
            </Chip>
            <Chip>
              שפה:{" "}
              {LANGUAGE_LABELS[pending.language as keyof typeof LANGUAGE_LABELS] ?? pending.language}
            </Chip>
            <Chip>
              {AUDIENCE_LABELS[pending.audience as keyof typeof AUDIENCE_LABELS] ?? pending.audience}
            </Chip>
          </div>

          {(pending.numAdults != null ||
            pending.numChildren != null ||
            pending.datesInterest ||
            pending.roomTypeInterest ||
            pending.budgetSignal) && (
            <section className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <Field label="מבוגרים" value={pending.numAdults} />
              <Field label="ילדים" value={pending.numChildren} />
              {pending.agesChildren && (
                <Field label="גילי ילדים" value={pending.agesChildren} span />
              )}
              {pending.datesInterest && (
                <Field label="תאריכים" value={pending.datesInterest} span />
              )}
              {pending.roomTypeInterest && (
                <Field label="חדר" value={pending.roomTypeInterest} span />
              )}
              {pending.budgetSignal && (
                <Field
                  label="תקציב"
                  value={
                    pending.budgetSignal === "low"
                      ? "נמוך"
                      : pending.budgetSignal === "mid"
                        ? "בינוני"
                        : "גבוה"
                  }
                />
              )}
            </section>
          )}

          {pending.whatSpokeToThem && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                מה תפס אותו
              </h3>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {pending.whatSpokeToThem}
              </p>
            </section>
          )}

          {pending.objections && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                התנגדויות
              </h3>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">
                {pending.objections}
              </p>
            </section>
          )}

          {pending.interestTags && pending.interestTags.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                עניין
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {pending.interestTags.map((t) => (
                  <Chip key={t}>{INTEREST_TAG_LABELS[t] ?? t}</Chip>
                ))}
              </div>
            </section>
          )}

          {followupLabel && (
            <section className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 flex items-center gap-1.5 mb-1">
                <Clock className="size-3.5" />
                פולואפ מוצע · {followupLabel}
              </div>
              {pending.suggestedFollowupReason && (
                <p className="text-sm">{pending.suggestedFollowupReason}</p>
              )}
              {pending.followupReasoning && (
                <p className="text-xs text-muted-foreground mt-1 italic">
                  {pending.followupReasoning}
                </p>
              )}
            </section>
          )}

          {pending.transcriptPreview && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                תצוגה מקדימה של התמלול
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground leading-relaxed">
                {pending.transcriptPreview}
                {pending.transcriptPreview.length >= 500 && "…"}
              </p>
            </details>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          הליד מסומן לאישור אבל אין נתונים מחולצים (התמלול נכשל או היה ריק).
        </p>
      )}

      <footer className="flex gap-2 pt-1">
        <form action={approve} className="flex-1">
          <button
            type="submit"
            className="press w-full h-11 rounded-full bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-1.5 shadow-pop"
            disabled={!pending}
          >
            <CheckCircle2 className="size-4" strokeWidth={2.4} />
            אשר ויצר פולואפ
          </button>
        </form>
        <form action={reject}>
          <button
            type="submit"
            className="press h-11 px-4 rounded-full bg-card border border-border font-medium text-sm flex items-center justify-center gap-1.5"
          >
            <X className="size-4" strokeWidth={2.2} />
            דלג
          </button>
        </form>
        <form action={del}>
          <button
            type="submit"
            className="press size-11 rounded-full bg-destructive/10 text-destructive border border-destructive/20 flex items-center justify-center"
            aria-label="מחק ליד"
          >
            <Trash2 className="size-4" strokeWidth={2.2} />
          </button>
        </form>
      </footer>
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground font-medium">
      {children}
    </span>
  );
}

function Field({
  label,
  value,
  span,
}: {
  label: string;
  value: React.ReactNode;
  span?: boolean;
}) {
  if (value == null || value === "") return null;
  return (
    <div className={span ? "col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
