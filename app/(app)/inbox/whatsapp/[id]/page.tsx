import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import { eq, inArray } from "drizzle-orm";
import { db, leads, pendingWhatsAppImports } from "@/db";
import {
  LeadReviewForm,
  type ExtractedLeadData,
  type ExistingMatch,
} from "@/components/lead-review-form";
import type { ExtractedLead } from "@/lib/ai-client";

export const dynamic = "force-dynamic";

export default async function WhatsAppImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [row] = await db
    .select()
    .from(pendingWhatsAppImports)
    .where(eq(pendingWhatsAppImports.id, id));

  if (!row) notFound();
  if (row.status === "merged" || row.status === "dismissed") {
    redirect("/inbox");
  }

  // Still cooking — show a waiting shell instead of an empty form.
  if (row.status === "pending" || row.status === "processing") {
    return (
      <div className="px-4 pt-4 pb-6 space-y-4">
        <BackHeader />
        <div className="rounded-2xl border bg-card p-6 text-center space-y-3 shadow-soft">
          <Loader2 className="size-8 mx-auto animate-spin text-primary" />
          <div className="font-medium">השיחה עדיין בעיבוד</div>
          <div className="text-sm text-muted-foreground">
            תמלול הודעות קוליות + חילוץ פרטים רצים ברקע.
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
          <p className="text-xs text-muted-foreground">
            לא מחייבים אותך בטוקנים על ניסיון כושל. אם זו היתה שגיאה זמנית
            העלה מחדש. אם זה פורמט בעייתי, דווח.
          </p>
        </div>
      </div>
    );
  }

  // status === "done"
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

  const audioStats =
    (row.audioStats as
      | { total: number; transcribed: number; skipped: number }
      | null) ?? { total: 0, transcribed: 0, skipped: 0 };

  return (
    <div className="px-4 pt-4 pb-4 space-y-4">
      <BackHeader />
      <LeadReviewForm
        extracted={extraction as ExtractedLeadData}
        mode={{
          kind: "import",
          pendingImportId: row.id,
          inferredName: row.inferredLeadName,
          inferredPhone: row.inferredPhones[0] ?? null,
          existingMatches: matches,
          audioStats,
          chatTranscript: row.renderedChat ?? "",
          messageCount: row.messageCount ?? 0,
        }}
      />
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
      <h1 className="text-lg font-semibold">אישור ייבוא וואטסאפ</h1>
      <div className="w-12" />
    </header>
  );
}
