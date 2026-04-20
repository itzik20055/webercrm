import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { eq } from "drizzle-orm";
import { db, leads } from "@/db";
import { LeadReviewForm } from "@/components/lead-review-form";
import type { PendingExtraction } from "../actions";

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  phone_call: "שיחת טלפון",
  whatsapp: "וואטסאפ",
};

export default async function InboxReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [lead] = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      needsReview: leads.needsReview,
      pendingExtraction: leads.pendingExtraction,
    })
    .from(leads)
    .where(eq(leads.id, id));

  if (!lead) notFound();
  if (!lead.needsReview || !lead.pendingExtraction) {
    redirect("/inbox");
  }

  const pending = lead.pendingExtraction as PendingExtraction;
  const sourceLabel = SOURCE_LABELS[pending.source ?? ""] ?? "לא ידוע";

  return (
    <div className="px-4 pt-4 pb-4 space-y-4">
      <header className="flex items-center justify-between">
        <Link
          href="/queue"
          className="press flex items-center gap-1 text-sm text-muted-foreground h-11 px-2 -mx-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ChevronRight className="size-4" />
          חזרה לתור
        </Link>
        <h1 className="text-lg font-semibold">אישור ליד מ-AI</h1>
        <div className="w-12" />
      </header>

      <LeadReviewForm
        extracted={pending}
        mode={{
          kind: "approve",
          leadId: lead.id,
          leadName: lead.name,
          leadPhone: lead.phone,
          transcriptPreview: pending.transcriptPreview ?? null,
          sourceLabel,
        }}
      />
    </div>
  );
}
