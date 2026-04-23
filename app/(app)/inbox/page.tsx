import Link from "next/link";
import {
  Inbox as InboxIcon,
  CheckCircle2,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Sparkles,
  ChevronLeft,
  Trash2,
  X,
  MessageCircle,
  Mail,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  db,
  leads,
  pendingCallRecordings,
  pendingEmails,
  pendingWhatsAppImports,
  type Lead,
  type PendingEmail,
  type PendingWhatsAppImport,
} from "@/db";
import { desc, eq, inArray } from "drizzle-orm";
import {
  rejectPendingExtraction,
  deleteLeadFromInbox,
  dismissCallRecording,
  dismissWhatsAppImport,
  dismissEmailImport,
  mergeEmailBatch,
  type PendingExtraction,
} from "./actions";
import {
  fullDate,
  relativeTime,
  telLink,
  whatsappLink,
} from "@/lib/format";

export const dynamic = "force-dynamic";

interface PendingExtractionLite {
  customerName?: string | null;
  summary?: string | null;
}

export default async function InboxPage() {
  const [pendingRecordings, reviewLeads, waImports, emailRows] = await Promise.all([
    db
      .select()
      .from(pendingCallRecordings)
      .where(eq(pendingCallRecordings.status, "pending"))
      .orderBy(desc(pendingCallRecordings.createdAt))
      .limit(50),
    db
      .select()
      .from(leads)
      .where(eq(leads.needsReview, true))
      .orderBy(desc(leads.updatedAt))
      .limit(50),
    db
      .select({
        id: pendingWhatsAppImports.id,
        status: pendingWhatsAppImports.status,
        originalFilename: pendingWhatsAppImports.originalFilename,
        inferredLeadName: pendingWhatsAppImports.inferredLeadName,
        inferredPhones: pendingWhatsAppImports.inferredPhones,
        extraction: pendingWhatsAppImports.extraction,
        audioStats: pendingWhatsAppImports.audioStats,
        messageCount: pendingWhatsAppImports.messageCount,
        matchCandidateIds: pendingWhatsAppImports.matchCandidateIds,
        error: pendingWhatsAppImports.error,
        createdAt: pendingWhatsAppImports.createdAt,
        processedAt: pendingWhatsAppImports.processedAt,
      })
      .from(pendingWhatsAppImports)
      .where(
        inArray(pendingWhatsAppImports.status, [
          "pending",
          "processing",
          "done",
          "failed",
        ])
      )
      .orderBy(desc(pendingWhatsAppImports.createdAt))
      .limit(50),
    db
      .select()
      .from(pendingEmails)
      .where(
        inArray(pendingEmails.status, ["pending", "processing", "done", "failed"])
      )
      .orderBy(desc(pendingEmails.createdAt))
      .limit(50),
  ]);

  const emailLeadIds = Array.from(
    new Set(
      emailRows
        .map((r) => r.leadId)
        .filter((id): id is string => !!id)
    )
  );
  const emailLeadRows =
    emailLeadIds.length > 0
      ? await db
          .select({
            id: leads.id,
            name: leads.name,
            email: leads.email,
          })
          .from(leads)
          .where(inArray(leads.id, emailLeadIds))
      : [];
  const emailLeadsById = new Map(emailLeadRows.map((l) => [l.id, l]));

  const total =
    pendingRecordings.length +
    reviewLeads.length +
    waImports.length +
    emailRows.length;

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground tracking-tight flex items-center gap-1.5">
            <InboxIcon className="size-3.5" />
            תיבת נכנסים
          </p>
          <h1 className="text-[26px] font-bold tracking-tight leading-tight">
            לאישור
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            הקלטות שיחה וטיוטות שמחכות שתאשר ליצירה או למיזוג.
          </p>
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
          <p className="font-semibold tracking-tight">התיבה ריקה</p>
          <p className="text-sm text-muted-foreground">
            אין הקלטות חדשות או לידים שמחכים לאישור.
          </p>
        </div>
      )}

      {pendingRecordings.length > 0 && (
        <Group title="שיחות מוקלטות" tone="primary" count={pendingRecordings.length}>
          {pendingRecordings.map((r) => (
            <PendingCallCard key={r.id} recording={r} />
          ))}
        </Group>
      )}

      {waImports.length > 0 && (
        <Group title="ייבוא וואטסאפ" tone="primary" count={waImports.length}>
          {waImports.map((r) => (
            <WhatsAppImportCard key={r.id} row={r} />
          ))}
        </Group>
      )}

      {emailRows.length > 0 && (
        <Group title="מיילים" tone="primary" count={emailRows.length}>
          {emailRows.map((r) => (
            <EmailImportCard
              key={r.id}
              row={r}
              lead={r.leadId ? emailLeadsById.get(r.leadId) ?? null : null}
            />
          ))}
        </Group>
      )}

      {reviewLeads.length > 0 && (
        <Group title="לידים מטיוטה" count={reviewLeads.length}>
          {reviewLeads.map((l) => (
            <ReviewLeadCard
              key={l.id}
              lead={l}
              pending={l.pendingExtraction as PendingExtraction | null}
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
  tone?: "default" | "primary";
  count: number;
  children: React.ReactNode;
}) {
  const dotClass =
    tone === "primary" ? "bg-primary" : "bg-muted-foreground/40";
  const titleClass = tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-1.5 px-1">
        <span className={"size-1.5 rounded-full shrink-0 " + dotClass} />
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

function PendingCallCard({
  recording,
}: {
  recording: {
    id: string;
    customerPhone: string;
    direction: "in" | "out" | "internal";
    callAt: Date;
    transcript: string | null;
    transcriptionError: string | null;
    extraction: unknown;
    matchCandidateIds: string[];
    createdAt: Date;
  };
}) {
  const e = recording.extraction as PendingExtractionLite | null;
  const inferredName = e?.customerName?.trim();
  const summary = e?.summary?.trim();
  const candidateCount = recording.matchCandidateIds.length;
  const dismiss = dismissCallRecording.bind(null, recording.id);
  const DirIcon = recording.direction === "out" ? PhoneOutgoing : PhoneIncoming;

  return (
    <article className="bg-card border border-border/70 rounded-2xl shadow-soft overflow-hidden">
      <Link
        href={`/inbox/call/${recording.id}`}
        className="press block p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="פתח לאישור"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <DirIcon className="size-4 text-primary" strokeWidth={2.2} />
              <span className="font-semibold tracking-tight truncate">
                {inferredName || recording.customerPhone}
              </span>
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
                <Sparkles className="size-2.5" />
                AI
              </span>
              {candidateCount > 0 && (
                <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 rounded-full px-1.5 py-0.5">
                  ליד תואם
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              <span dir="ltr">{recording.customerPhone}</span>
              <span>·</span>
              <span>{fullDate(recording.callAt)}</span>
              <span>·</span>
              <span>{relativeTime(recording.createdAt)}</span>
            </div>
            {summary ? (
              <p className="text-sm text-foreground/85 line-clamp-3 leading-snug pt-0.5 whitespace-pre-line">
                {summary}
              </p>
            ) : recording.transcript ? (
              <p className="text-sm text-muted-foreground line-clamp-2 leading-snug pt-0.5">
                {recording.transcript.slice(0, 180)}
              </p>
            ) : recording.transcriptionError ? (
              <p className="text-sm text-amber-700 dark:text-amber-300 italic pt-0.5 flex items-center gap-1">
                <AlertTriangle className="size-3.5" />
                תמלול נכשל
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic pt-0.5">
                אין תמלול עדיין
              </p>
            )}
          </div>
          <ChevronLeft className="size-5 text-muted-foreground shrink-0 mt-1" />
        </div>
      </Link>

      <div className="border-t border-border/60 bg-muted/30 px-2 py-1.5 flex items-center gap-1">
        <a
          href={telLink(recording.customerPhone)}
          className="press size-11 rounded-full text-primary flex items-center justify-center hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="חייג"
        >
          <Phone className="size-[18px]" strokeWidth={2.2} />
        </a>
        <a
          href={whatsappLink(recording.customerPhone)}
          target="_blank"
          rel="noreferrer"
          className="press size-11 rounded-full text-emerald-700 dark:text-emerald-300 flex items-center justify-center hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          aria-label="וואטסאפ"
        >
          <MessageCircle className="size-[18px]" strokeWidth={2.2} />
        </a>
        <div className="flex-1" />
        <form action={dismiss}>
          <button
            type="submit"
            className="press h-11 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="דלג"
          >
            <X className="size-4" strokeWidth={2.2} />
            דלג
          </button>
        </form>
      </div>
    </article>
  );
}

function WhatsAppImportCard({
  row,
}: {
  row: Pick<
    PendingWhatsAppImport,
    | "id"
    | "status"
    | "originalFilename"
    | "inferredLeadName"
    | "inferredPhones"
    | "extraction"
    | "audioStats"
    | "messageCount"
    | "matchCandidateIds"
    | "error"
    | "createdAt"
    | "processedAt"
  >;
}) {
  const isWorking = row.status === "pending" || row.status === "processing";
  const failed = row.status === "failed";
  const done = row.status === "done";
  const extraction = (row.extraction as PendingExtractionLite | null) ?? null;
  const displayName =
    extraction?.customerName?.trim() ||
    row.inferredLeadName?.trim() ||
    row.originalFilename;
  const phone = row.inferredPhones?.[0];
  const summary = extraction?.summary?.trim();
  const dismiss = dismissWhatsAppImport.bind(null, row.id);

  const body = (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <MessageCircle
            className="size-4 text-emerald-700 dark:text-emerald-300"
            strokeWidth={2.2}
          />
          <span className="font-semibold tracking-tight truncate">
            {displayName}
          </span>
          {isWorking && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
              <Loader2 className="size-2.5 animate-spin" />
              מעבד
            </span>
          )}
          {done && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
              <Sparkles className="size-2.5" />
              AI
            </span>
          )}
          {failed && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">
              <AlertTriangle className="size-2.5" />
              נכשל
            </span>
          )}
          {done && row.matchCandidateIds.length > 0 && (
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 rounded-full px-1.5 py-0.5">
              ליד תואם
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
          {phone && (
            <>
              <span dir="ltr">{phone}</span>
              <span>·</span>
            </>
          )}
          <span>{relativeTime(row.createdAt)}</span>
          {done && row.messageCount && (
            <>
              <span>·</span>
              <span>{row.messageCount} הודעות</span>
            </>
          )}
        </div>
        {isWorking ? (
          <p className="text-sm text-muted-foreground italic pt-0.5">
            מתמלל הודעות קוליות ומחלץ פרטים...
          </p>
        ) : failed ? (
          <p className="text-sm text-destructive/90 line-clamp-2 leading-snug pt-0.5">
            {row.error ?? "שגיאה לא ידועה"}
          </p>
        ) : summary ? (
          <p className="text-sm text-foreground/85 line-clamp-3 leading-snug pt-0.5 whitespace-pre-line">
            {summary}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic pt-0.5">
            אין סיכום — תצטרך למלא ידנית.
          </p>
        )}
      </div>
      {done && <ChevronLeft className="size-5 text-muted-foreground shrink-0 mt-1" />}
    </div>
  );

  return (
    <article className="bg-card border border-border/70 rounded-2xl shadow-soft overflow-hidden">
      {done ? (
        <Link
          href={`/inbox/whatsapp/${row.id}`}
          className="press block p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="פתח לאישור"
        >
          {body}
        </Link>
      ) : (
        <div className="p-4">{body}</div>
      )}

      <div className="border-t border-border/60 bg-muted/30 px-2 py-1.5 flex items-center gap-1">
        {phone && done && (
          <a
            href={whatsappLink(phone)}
            target="_blank"
            rel="noreferrer"
            className="press size-11 rounded-full text-emerald-700 dark:text-emerald-300 flex items-center justify-center hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="וואטסאפ"
          >
            <MessageCircle className="size-[18px]" strokeWidth={2.2} />
          </a>
        )}
        <div className="flex-1" />
        <form action={dismiss}>
          <button
            type="submit"
            className="press h-11 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="דלג"
          >
            <X className="size-4" strokeWidth={2.2} />
            דלג
          </button>
        </form>
      </div>
    </article>
  );
}

function EmailImportCard({
  row,
  lead,
}: {
  row: PendingEmail;
  lead: { id: string; name: string; email: string | null } | null;
}) {
  const isWorking = row.status === "pending" || row.status === "processing";
  const failed = row.status === "failed";
  const done = row.status === "done";
  const extraction =
    (row.extraction as PendingExtractionLite | null) ?? null;
  const isUpdateBatch = row.kind === "update_batch";

  const displayName = isUpdateBatch
    ? lead?.name ?? "ליד"
    : extraction?.customerName?.trim() || row.emailAddress || "ייבוא מייל";
  const addressLine = isUpdateBatch
    ? lead?.email ?? ""
    : row.emailAddress ?? "";
  const summary = isUpdateBatch
    ? `${row.messageCount} הודעות חדשות מאז הסנכרון האחרון`
    : extraction?.summary?.trim();

  const dismiss = dismissEmailImport.bind(null, row.id);
  const merge = isUpdateBatch ? mergeEmailBatch.bind(null, row.id) : null;

  const linkHref = `/inbox/email/${row.id}`;

  const body = (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Mail className="size-4 text-primary" strokeWidth={2.2} />
          <span className="font-semibold tracking-tight truncate">
            {displayName}
          </span>
          {isWorking && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
              <Loader2 className="size-2.5 animate-spin" />
              מעבד
            </span>
          )}
          {done && !isUpdateBatch && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
              <Sparkles className="size-2.5" />
              AI
            </span>
          )}
          {isUpdateBatch && (
            <span className="text-[10px] font-semibold text-primary bg-primary-soft rounded-full px-1.5 py-0.5">
              עדכון
            </span>
          )}
          {failed && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5">
              <AlertTriangle className="size-2.5" />
              נכשל
            </span>
          )}
          {done && !isUpdateBatch && row.matchCandidateIds.length > 0 && (
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 rounded-full px-1.5 py-0.5">
              ליד תואם
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
          {addressLine && (
            <>
              <span dir="ltr" className="truncate max-w-[200px]">
                {addressLine}
              </span>
              <span>·</span>
            </>
          )}
          <span>{relativeTime(row.createdAt)}</span>
          {done && row.messageCount > 0 && (
            <>
              <span>·</span>
              <span>{row.messageCount} הודעות</span>
            </>
          )}
        </div>
        {isWorking ? (
          <p className="text-sm text-muted-foreground italic pt-0.5">
            שולף את ההתכתבות מ-Gmail ומחלץ פרטים...
          </p>
        ) : failed ? (
          <p className="text-sm text-destructive/90 line-clamp-2 leading-snug pt-0.5">
            {row.error ?? "שגיאה לא ידועה"}
          </p>
        ) : summary ? (
          <p className="text-sm text-foreground/85 line-clamp-3 leading-snug pt-0.5 whitespace-pre-line">
            {summary}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic pt-0.5">
            פתח לסקירה
          </p>
        )}
      </div>
      {done && <ChevronLeft className="size-5 text-muted-foreground shrink-0 mt-1" />}
    </div>
  );

  return (
    <article className="bg-card border border-border/70 rounded-2xl shadow-soft overflow-hidden">
      {done ? (
        <Link
          href={linkHref}
          className="press block p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="פתח לאישור"
        >
          {body}
        </Link>
      ) : (
        <div className="p-4">{body}</div>
      )}

      <div className="border-t border-border/60 bg-muted/30 px-2 py-1.5 flex items-center gap-1">
        {merge && done && (
          <form action={merge} className="flex-1">
            <button
              type="submit"
              className="press w-full h-11 px-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Sparkles className="size-4" strokeWidth={2.2} />
              מזג ועבד מחדש
            </button>
          </form>
        )}
        {!merge && <div className="flex-1" />}
        <form action={dismiss}>
          <button
            type="submit"
            className="press h-11 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-card flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="דלג"
          >
            <X className="size-4" strokeWidth={2.2} />
            דלג
          </button>
        </form>
      </div>
    </article>
  );
}

function ReviewLeadCard({
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
