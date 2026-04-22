"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  leads,
  followups,
  interactions,
  pendingCallRecordings,
  pendingWhatsAppImports,
} from "@/db";
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
  revalidatePath("/queue");
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
  revalidatePath("/queue");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
}

export async function deleteLeadFromInbox(leadId: string) {
  await db.delete(leads).where(eq(leads.id, leadId));
  revalidatePath("/inbox");
  revalidatePath("/queue");
  revalidatePath("/leads");
  revalidatePath("/");
  redirect("/inbox");
}

// ─── Pending call recordings ──────────────────────────────────────────

const callApproveSchema = approveSchema; // reuse same field set

function parseFormData(formData: FormData) {
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
  return obj;
}

async function loadPending(pendingId: string) {
  const [row] = await db
    .select()
    .from(pendingCallRecordings)
    .where(eq(pendingCallRecordings.id, pendingId));
  return row ?? null;
}

function buildCallInteractionContent(opts: {
  callAt: Date;
  customerPhone: string;
  transcript: string | null;
  transcriptionError: string | null;
  newLead: boolean;
}): string {
  const header = opts.newLead
    ? `[שיחת טלפון מ-${opts.customerPhone} — ${opts.callAt.toLocaleString("he-IL")}]\n(ליד חדש שנוצר מהקלטת השיחה)`
    : `[שיחת טלפון — ${opts.callAt.toLocaleString("he-IL")}]`;
  const body = opts.transcript
    ? opts.transcript
    : opts.transcriptionError
      ? `[תמלול נכשל: ${opts.transcriptionError}]`
      : "[ללא תמלול זמין]";
  return `${header}\n\n${body}`;
}

/**
 * Approve a pending call recording → create a brand-new lead from the
 * user-edited form values + log the transcript as the first interaction.
 */
export async function approveCallRecording(
  pendingId: string,
  formData: FormData
) {
  const parsed = callApproveSchema.parse(parseFormData(formData));
  const pending = await loadPending(pendingId);
  if (!pending) throw new Error("הקלטה לא נמצאה");
  if (pending.status !== "pending") {
    redirect("/inbox");
  }

  const [created] = await db
    .insert(leads)
    .values({
      name: parsed.name,
      phone: parsed.phone,
      language: parsed.language,
      audience: parsed.audience,
      channelFirst: "call",
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
    .returning({ id: leads.id });

  await db.insert(interactions).values({
    leadId: created.id,
    type: pending.direction === "in" ? "call_in" : "call_out",
    direction: pending.direction,
    content: buildCallInteractionContent({
      callAt: pending.callAt,
      customerPhone: pending.customerPhone,
      transcript: pending.transcript,
      transcriptionError: pending.transcriptionError,
      newLead: true,
    }),
    occurredAt: pending.callAt,
  });

  if (parsed.followupAt) {
    const due = new Date(parsed.followupAt);
    if (!isNaN(due.getTime())) {
      await db.insert(followups).values({
        leadId: created.id,
        dueAt: due,
        reason: parsed.followupReason ?? null,
      });
      await db
        .update(leads)
        .set({ nextFollowupAt: due, updatedAt: new Date() })
        .where(eq(leads.id, created.id));
    }
  }

  await db
    .update(pendingCallRecordings)
    .set({
      status: "approved",
      resolvedLeadId: created.id,
      resolvedAt: new Date(),
    })
    .where(eq(pendingCallRecordings.id, pendingId));

  revalidatePath("/inbox");
  revalidatePath("/queue");
  revalidatePath("/leads");
  revalidatePath("/");
  redirect(`/leads/${created.id}`);
}

// Merging into an existing lead — the target already has name/phone, and the
// UI hides those inputs when the user picks "merge". Drop them from the
// required set; otherwise Zod throws before we ever touch the DB.
const callMergeSchema = callApproveSchema
  .omit({ name: true, phone: true })
  .extend({
    leadId: z.string().uuid(),
  });

/**
 * Merge a pending call recording into an existing lead. Fields use fill-if-
 * empty semantics — we never silently overwrite data already on the lead.
 * Tags are unioned. The transcript is appended as a new interaction.
 */
export async function mergeCallRecording(
  pendingId: string,
  formData: FormData
) {
  const parsed = callMergeSchema.parse(parseFormData(formData));
  const pending = await loadPending(pendingId);
  if (!pending) throw new Error("הקלטה לא נמצאה");
  if (pending.status !== "pending") {
    redirect("/inbox");
  }

  const [existing] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, parsed.leadId));
  if (!existing) throw new Error("הליד לא נמצא");

  const update: Record<string, unknown> = { updatedAt: new Date() };
  const fillIfEmpty = (field: string, current: unknown, next: unknown) => {
    if (next == null || next === "") return;
    if (current != null && current !== "") return;
    update[field] = next;
  };
  fillIfEmpty("numAdults", existing.numAdults, parsed.numAdults);
  fillIfEmpty("numChildren", existing.numChildren, parsed.numChildren);
  fillIfEmpty("agesChildren", existing.agesChildren, parsed.agesChildren);
  fillIfEmpty("datesInterest", existing.datesInterest, parsed.datesInterest);
  fillIfEmpty("roomTypeInterest", existing.roomTypeInterest, parsed.roomTypeInterest);
  fillIfEmpty("budgetSignal", existing.budgetSignal, parsed.budgetSignal);
  fillIfEmpty("whatSpokeToThem", existing.whatSpokeToThem, parsed.whatSpokeToThem);
  fillIfEmpty("objections", existing.objections, parsed.objections);

  // status/priority advance only — never regress
  const STATUS_RANK: Record<string, number> = {
    new: 0,
    contacted: 1,
    interested: 2,
    quoted: 3,
    closing: 4,
    booked: 5,
    lost: 5,
  };
  const PRIORITY_RANK: Record<string, number> = { cold: 0, warm: 1, hot: 2 };
  if (
    (STATUS_RANK[parsed.status] ?? -1) > (STATUS_RANK[existing.status] ?? -1)
  ) {
    update.status = parsed.status;
  }
  if (
    (PRIORITY_RANK[parsed.priority] ?? -1) > (PRIORITY_RANK[existing.priority] ?? -1)
  ) {
    update.priority = parsed.priority;
  }

  // Tags: union, deduped
  const mergedTags = Array.from(
    new Set([...(existing.interestTags ?? []), ...parsed.interestTags])
  );
  if (mergedTags.length !== (existing.interestTags ?? []).length) {
    update.interestTags = mergedTags;
  }

  await db.update(leads).set(update).where(eq(leads.id, parsed.leadId));

  await db.insert(interactions).values({
    leadId: parsed.leadId,
    type: pending.direction === "in" ? "call_in" : "call_out",
    direction: pending.direction,
    content: buildCallInteractionContent({
      callAt: pending.callAt,
      customerPhone: pending.customerPhone,
      transcript: pending.transcript,
      transcriptionError: pending.transcriptionError,
      newLead: false,
    }),
    occurredAt: pending.callAt,
  });

  if (parsed.followupAt) {
    const due = new Date(parsed.followupAt);
    if (!isNaN(due.getTime())) {
      await supersedeOpenFollowups(parsed.leadId);
      await db.insert(followups).values({
        leadId: parsed.leadId,
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
        .where(eq(leads.id, parsed.leadId));
    }
  }

  await db
    .update(pendingCallRecordings)
    .set({
      status: "merged",
      resolvedLeadId: parsed.leadId,
      resolvedAt: new Date(),
    })
    .where(eq(pendingCallRecordings.id, pendingId));

  revalidatePath("/inbox");
  revalidatePath("/queue");
  revalidatePath("/leads");
  revalidatePath(`/leads/${parsed.leadId}`);
  revalidatePath("/");
  redirect(`/leads/${parsed.leadId}`);
}

export async function dismissCallRecording(pendingId: string) {
  await db
    .update(pendingCallRecordings)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(eq(pendingCallRecordings.id, pendingId));
  revalidatePath("/inbox");
  revalidatePath("/");
}

export async function dismissWhatsAppImport(importId: string) {
  await db
    .update(pendingWhatsAppImports)
    .set({
      status: "dismissed",
      resolvedAt: new Date(),
      fileBytes: Buffer.alloc(0),
    })
    .where(eq(pendingWhatsAppImports.id, importId));
  revalidatePath("/inbox");
  revalidatePath("/");
}

