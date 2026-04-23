import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { eq, inArray } from "drizzle-orm";
import { db, leads, pendingEmails } from "@/db";
import {
  LeadReviewForm,
  type ExtractedLeadData,
  type ExistingMatch,
} from "@/components/lead-review-form";
import { mergeEmailBatch, dismissEmailImport } from "../../actions";
import type { ExtractedLead } from "@/lib/ai-client";

export const dynamic = "force-dynamic";

interface StoredEmailMessage {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  receivedAt: string;
  direction: "in" | "out";
}

export default async function EmailReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [row] = await db
    .select()
    .from(pendingEmails)
    .where(eq(pendingEmails.id, id));

  if (!row) notFound();
  if (row.status === "merged" || row.status === "dismissed") {
    redirect("/inbox");
  }

  if (row.status === "pending" || row.status === "processing") {
    return (
      <div className="px-4 pt-4 pb-6 space-y-4">
        <BackHeader />
        <div className="rounded-2xl border bg-card p-6 text-center space-y-3 shadow-soft">
          <Loader2 className="size-8 mx-auto animate-spin text-primary" />
          <div className="font-medium">שולף את ההתכתבות מ-Gmail</div>
          <div className="text-sm text-muted-foreground">
            שליפה + ניתוח AI רצים ברקע.
            <br />
            רענן את הדף בעוד דקה.
          </div>
        </div>
      </div>
    );
  }

  if (row.status === "failed") {
    return (
      <div className="px-4 pt-4 pb-6 space-y-4">
        <BackHeader />
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 space-y-2">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" />
            העיבוד נכשל
          </div>
          <p className="text-sm text-destructive/90 whitespace-pre-line">
            {row.error ?? "שגיאה לא ידועה"}
          </p>
        </div>
      </div>
    );
  }

  // row.status === "done"
  const messages = (row.messages as StoredEmailMessage[]) ?? [];

  if (row.kind === "update_batch") {
    return <UpdateBatchReview rowId={row.id} leadId={row.leadId} messages={messages} />;
  }

  // new_import — show the extraction form with the existing review UX.
  const matches: ExistingMatch[] =
    row.matchCandidateIds.length > 0
      ? (
          await db
            .select({
              id: leads.id,
              name: leads.name,
              phone: leads.phone,
              status: leads.status,
              updatedAt: leads.updatedAt,
            })
            .from(leads)
            .where(inArray(leads.id, row.matchCandidateIds))
        ).map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          status: l.status,
          updatedAt: l.updatedAt.toISOString(),
        }))
      : [];

  const extraction = row.extraction as ExtractedLead | null;
  if (!extraction) notFound();

  return (
    <div className="px-4 pt-4 pb-4 space-y-4">
      <BackHeader />
      <LeadReviewForm
        extracted={extraction as ExtractedLeadData}
        mode={{
          kind: "email-import",
          pendingId: row.id,
          inferredName: extraction.customerName ?? null,
          emailAddress: row.emailAddress ?? "",
          existingMatches: matches,
          messageCount: row.messageCount,
        }}
      />
      <details className="rounded-xl border bg-card p-3 text-sm">
        <summary className="font-medium cursor-pointer">
          התכתבות מלאה ({messages.length})
        </summary>
        <MessagesList messages={messages} />
      </details>
    </div>
  );
}

async function UpdateBatchReview({
  rowId,
  leadId,
  messages,
}: {
  rowId: string;
  leadId: string | null;
  messages: StoredEmailMessage[];
}) {
  if (!leadId) notFound();
  const [lead] = await db
    .select({ id: leads.id, name: leads.name, email: leads.email })
    .from(leads)
    .where(eq(leads.id, leadId));
  if (!lead) notFound();

  const merge = mergeEmailBatch.bind(null, rowId);
  const dismiss = dismissEmailImport.bind(null, rowId);

  return (
    <div className="px-4 pt-4 pb-4 space-y-4">
      <BackHeader />
      <div className="rounded-2xl border bg-card p-4 space-y-1.5 shadow-soft">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          עדכון על ליד קיים
        </div>
        <div className="text-lg font-semibold">{lead.name}</div>
        {lead.email && (
          <div className="text-xs text-muted-foreground" dir="ltr">
            {lead.email}
          </div>
        )}
        <div className="text-sm text-muted-foreground mt-2">
          {messages.length} הודעות חדשות נאספו ב-Gmail מאז הסנכרון האחרון.
          לחץ <strong>"מזג ועבד מחדש"</strong> — ההודעות יתווספו כ-interactions
          ל-{lead.name}, ו-AI יריץ ריפרוסס על כל ההיסטוריה ויציע פולואפ/שינוי
          עדיפות בהתאם.
        </div>
      </div>

      <MessagesList messages={messages} />

      <div className="flex gap-2 sticky bottom-2">
        <form action={merge} className="flex-1">
          <button
            type="submit"
            className="press w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold shadow-pop flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Sparkles className="size-4" />
            מזג ועבד מחדש
          </button>
        </form>
        <form action={dismiss}>
          <button
            type="submit"
            className="press h-12 px-4 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            התעלם
          </button>
        </form>
      </div>
    </div>
  );
}

function MessagesList({ messages }: { messages: StoredEmailMessage[] }) {
  return (
    <div className="space-y-2">
      {messages.map((m) => {
        const dateLabel = new Date(m.receivedAt).toLocaleString("he-IL", {
          timeZone: "Asia/Jerusalem",
        });
        return (
          <article
            key={m.messageId}
            className="rounded-xl border bg-card p-3 space-y-1.5 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
                {m.direction === "out" ? "יוצא" : "נכנס"}
              </span>
              <span className="text-xs text-muted-foreground">{dateLabel}</span>
            </div>
            <div className="text-xs text-muted-foreground" dir="ltr">
              {m.direction === "out" ? "אל: " : "מאת: "}
              {m.direction === "out" ? m.to.join(", ") : m.from}
            </div>
            {m.subject && (
              <div className="text-sm font-medium">נושא: {m.subject}</div>
            )}
            <div className="whitespace-pre-line text-foreground/85 leading-relaxed">
              {m.bodyText}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function BackHeader() {
  return (
    <header className="flex items-center justify-between">
      <Link
        href="/inbox"
        className="press flex items-center gap-1 text-sm text-muted-foreground h-11 px-2 -mx-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ChevronRight className="size-4" />
        חזרה לתיבה
      </Link>
      <h1 className="text-lg font-semibold">אישור ייבוא מייל</h1>
      <div className="w-12" />
    </header>
  );
}
