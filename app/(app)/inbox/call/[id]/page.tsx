import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { eq, inArray } from "drizzle-orm";
import { db, leads, pendingCallRecordings } from "@/db";
import {
  LeadReviewForm,
  type ExtractedLeadData,
  type ExistingMatch,
} from "@/components/lead-review-form";
import type { ExtractedLead } from "@/lib/ai-client";

export const dynamic = "force-dynamic";

export default async function CallReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [recording] = await db
    .select()
    .from(pendingCallRecordings)
    .where(eq(pendingCallRecordings.id, id));

  if (!recording) notFound();
  if (recording.status !== "pending") {
    redirect("/inbox");
  }

  const matches: ExistingMatch[] =
    recording.matchCandidateIds.length > 0
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
            .where(inArray(leads.id, recording.matchCandidateIds))
        ).map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          status: l.status,
          updatedAt: l.updatedAt.toISOString(),
        }))
      : [];

  const extraction = recording.extraction as ExtractedLead | null;
  const extracted: ExtractedLeadData = extraction
    ? extraction
    : fallbackExtracted(recording.transcript, recording.transcriptionError);

  const callAtLabel = recording.callAt.toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="px-4 pt-4 pb-4 space-y-4">
      <header className="flex items-center justify-between">
        <Link
          href="/inbox"
          className="press flex items-center gap-1 text-sm text-muted-foreground h-11 px-2 -mx-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight className="size-4" />
          חזרה לתיבה
        </Link>
        <h1 className="text-lg font-semibold">אישור הקלטת שיחה</h1>
        <div className="w-12" />
      </header>

      {!extraction && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            {recording.transcriptionError
              ? "התמלול נכשל — מלא את הפרטים ידנית."
              : "אין סיכום AI לשיחה — מלא את הפרטים ידנית."}
          </div>
        </div>
      )}

      <LeadReviewForm
        extracted={extracted}
        mode={{
          kind: "call",
          pendingId: recording.id,
          inferredName: extraction?.customerName ?? null,
          inferredPhone: recording.customerPhone,
          existingMatches: matches,
          transcriptPreview: recording.transcript,
          callAtLabel,
          direction: recording.direction === "out" ? "out" : "in",
        }}
      />
    </div>
  );
}

function fallbackExtracted(
  transcript: string | null,
  transcriptionError: string | null
): ExtractedLeadData {
  const summary = transcript
    ? transcript.slice(0, 280)
    : transcriptionError
      ? `תמלול נכשל: ${transcriptionError}`
      : "לא היה תמלול זמין לשיחה הזו.";
  return {
    customerName: null,
    language: "he",
    audience: "israeli_haredi",
    numAdults: null,
    numChildren: null,
    agesChildren: null,
    datesInterest: null,
    roomTypeInterest: null,
    budgetSignal: null,
    interestTags: [],
    whatSpokeToThem: null,
    objections: null,
    status: "new",
    priority: "warm",
    summary,
    suggestedFollowupHours: 24,
    suggestedFollowupReason: "חזרה אליו אחרי השיחה",
    followupReasoning:
      "אין סיכום AI — ברירת מחדל של 24 שעות עד שתחזור אליו.",
  };
}
