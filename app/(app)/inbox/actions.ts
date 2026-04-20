"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, leads, followups } from "@/db";
import type { ExtractedLead } from "@/lib/ai-client";

export type PendingExtraction = ExtractedLead & {
  source?: string;
  transcriptPreview?: string;
  extractedAt?: string;
};

async function supersedeOpenFollowups(leadId: string) {
  await db
    .update(followups)
    .set({ completedAt: new Date() })
    .where(and(eq(followups.leadId, leadId), isNull(followups.completedAt)));
}

export async function approvePendingExtraction(leadId: string) {
  const [row] = await db
    .select({
      id: leads.id,
      pendingExtraction: leads.pendingExtraction,
      interestTags: leads.interestTags,
    })
    .from(leads)
    .where(eq(leads.id, leadId));
  if (!row) throw new Error("ליד לא נמצא");
  const p = row.pendingExtraction as PendingExtraction | null;
  if (!p) throw new Error("אין נתונים לאישור");

  const update: Record<string, unknown> = {
    updatedAt: new Date(),
    needsReview: false,
    pendingExtraction: null,
  };
  if (p.language) update.language = p.language;
  if (p.audience) update.audience = p.audience;
  if (p.status) update.status = p.status;
  if (p.priority) update.priority = p.priority;
  if (p.numAdults != null) update.numAdults = p.numAdults;
  if (p.numChildren != null) update.numChildren = p.numChildren;
  if (p.agesChildren) update.agesChildren = p.agesChildren;
  if (p.datesInterest) update.datesInterest = p.datesInterest;
  if (p.roomTypeInterest) update.roomTypeInterest = p.roomTypeInterest;
  if (p.budgetSignal) update.budgetSignal = p.budgetSignal;
  if (p.whatSpokeToThem) update.whatSpokeToThem = p.whatSpokeToThem;
  if (p.objections) update.objections = p.objections;

  if (p.interestTags && p.interestTags.length > 0) {
    const existing = new Set(row.interestTags ?? []);
    for (const t of p.interestTags) existing.add(t);
    update.interestTags = Array.from(existing);
  }

  await db.update(leads).set(update).where(eq(leads.id, leadId));

  // Create the suggested followup (if any) — supersede any open ones first so
  // we don't pile up duplicates on approval.
  if (
    p.suggestedFollowupHours != null &&
    p.suggestedFollowupHours > 0 &&
    p.status !== "booked" &&
    p.status !== "lost"
  ) {
    const due = new Date(Date.now() + p.suggestedFollowupHours * 3600_000);
    await supersedeOpenFollowups(leadId);
    await db.insert(followups).values({
      leadId,
      dueAt: due,
      reason: p.suggestedFollowupReason ?? null,
    });
    await db
      .update(leads)
      .set({ nextFollowupAt: due, followupCompletedAt: null, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
  }

  revalidatePath("/inbox");
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/followups");
  revalidatePath("/");
}

export async function rejectPendingExtraction(leadId: string) {
  await db
    .update(leads)
    .set({
      needsReview: false,
      pendingExtraction: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));
  revalidatePath("/inbox");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
}

export async function deleteLeadFromInbox(leadId: string) {
  await db.delete(leads).where(eq(leads.id, leadId));
  revalidatePath("/inbox");
  revalidatePath("/leads");
  revalidatePath("/");
  redirect("/inbox");
}
