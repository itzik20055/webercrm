"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? null : v), schema);

const approveSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(40),
  language: z.enum(["he", "en", "yi"]),
  audience: z.enum([
    "israeli_haredi",
    "american_haredi",
    "european_haredi",
  ]),
  status: z.enum([
    "new",
    "contacted",
    "interested",
    "quoted",
    "closing",
    "booked",
    "lost",
  ]),
  priority: z.enum(["hot", "warm", "cold"]),
  numAdults: emptyToNull(z.coerce.number().int().min(0).nullish()),
  numChildren: emptyToNull(z.coerce.number().int().min(0).nullish()),
  agesChildren: z.string().nullish(),
  datesInterest: z.string().nullish(),
  roomTypeInterest: z.string().nullish(),
  budgetSignal: emptyToNull(z.enum(["low", "mid", "high"]).nullish()),
  interestTags: z.array(z.string()).default([]),
  whatSpokeToThem: z.string().nullish(),
  objections: z.string().nullish(),
  followupAt: z.string().nullish(),
  followupReason: z.string().nullish(),
});

/**
 * Apply the user-edited form values to a lead pending review. Whatever the
 * user submitted in the form wins — they were just looking at the AI's
 * suggestion and had a chance to override every field.
 */
export async function approvePendingExtraction(
  leadId: string,
  formData: FormData
) {
  const obj: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    if (key === "interestTags") {
      const arr = (obj.interestTags as string[]) ?? [];
      arr.push(String(value));
      obj.interestTags = arr;
    } else {
      obj[key] = value;
    }
  });
  const parsed = approveSchema.parse(obj);

  const [existing] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.id, leadId));
  if (!existing) throw new Error("ליד לא נמצא");

  await db
    .update(leads)
    .set({
      updatedAt: new Date(),
      needsReview: false,
      pendingExtraction: null,
      name: parsed.name,
      phone: parsed.phone,
      language: parsed.language,
      audience: parsed.audience,
      status: parsed.status,
      priority: parsed.priority,
      numAdults: parsed.numAdults ?? null,
      numChildren: parsed.numChildren ?? null,
      agesChildren: parsed.agesChildren ?? null,
      datesInterest: parsed.datesInterest ?? null,
      roomTypeInterest: parsed.roomTypeInterest ?? null,
      budgetSignal: parsed.budgetSignal ?? null,
      interestTags: parsed.interestTags,
      whatSpokeToThem: parsed.whatSpokeToThem ?? null,
      objections: parsed.objections ?? null,
    })
    .where(eq(leads.id, leadId));

  if (parsed.followupAt) {
    const due = new Date(parsed.followupAt);
    if (!isNaN(due.getTime())) {
      await supersedeOpenFollowups(leadId);
      await db.insert(followups).values({
        leadId,
        dueAt: due,
        reason: parsed.followupReason ?? null,
      });
      await db
        .update(leads)
        .set({
          nextFollowupAt: due,
          followupCompletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));
    }
  }

  revalidatePath("/inbox");
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/followups");
  revalidatePath("/");
  redirect("/inbox");
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
