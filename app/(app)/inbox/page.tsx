import Link from "next/link";
import { db, leads } from "@/db";
import { desc, eq } from "drizzle-orm";
import {
  Inbox,
  Phone,
  MessageCircle,
  CheckCircle2,
  X,
  Trash2,
  ChevronLeft,
  Sparkles,
} from "lucide-react";
import { type Lead } from "@/db/schema";
import { relativeTime, telLink, whatsappLink } from "@/lib/format";
import {
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
          לידים שנוצרו אוטומטית מהקלטות שיחה. לחץ על כרטיס כדי לערוך ולאשר את
          הפרטים שה-AI חילץ.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-card border border-dashed border-border/70 p-6 text-center space-y-2">
          <CheckCircle2
            className="size-8 text-emerald-500 mx-auto"
            strokeWidth={1.8}
          />
          <p className="font-semibold tracking-tight">הכול נוקה</p>
          <p className="text-sm text-muted-foreground">
            אין לידים שמחכים לאישור כרגע.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
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
