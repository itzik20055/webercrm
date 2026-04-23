"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  leads,
  followups,
  interactions,
  pendingCallRecordings,
  pendingEmails,
  pendingWhatsAppImports,
} from "@/db";
import type { ExtractedLead } from "@/lib/ai-client";
import { normalizeEmailAddress } from "@/lib/email-config";
import { reprocessLeadWithAi } from "@/app/(app)/leads/actions";

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

// ─── Pending emails ───────────────────────────────────────────────────

export async function dismissEmailImport(importId: string) {
  await db
    .update(pendingEmails)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(eq(pendingEmails.id, importId));
  revalidatePath("/inbox");
  revalidatePath("/");
}

interface StoredEmailMessage {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  receivedAt: string;
  direction: "in" | "out";
}

function buildEmailInteractionContent(m: StoredEmailMessage): string {
  const whenLabel = new Date(m.receivedAt).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
  });
  const header = `[מייל ${m.direction === "out" ? "יוצא" : "נכנס"} — ${whenLabel}]${
    m.subject ? `\nנושא: ${m.subject}` : ""
  }`;
  return `${header}\n\n${m.bodyText.trim()}`;
}

async function appendEmailMessagesToLead(
  leadId: string,
  messages: StoredEmailMessage[]
): Promise<number> {
  if (messages.length === 0) return 0;

  // Dedup against interactions that already hold these Message-Ids — the
  // uniqueIndex on interactions.messageId is global, so if any lead already
  // has the Message-Id the insert would 23505. Pre-filter by querying ids
  // across the whole table.
  const ids = messages.map((m) => m.messageId);
  const existing = await db
    .select({ messageId: interactions.messageId })
    .from(interactions)
    .where(inArray(interactions.messageId, ids));
  const seen = new Set(existing.map((e) => e.messageId).filter(Boolean));

  const toInsert = messages.filter((m) => !seen.has(m.messageId));
  if (toInsert.length === 0) return 0;

  await db.insert(interactions).values(
    toInsert.map((m) => ({
      leadId,
      type: "email" as const,
      direction: m.direction,
      content: buildEmailInteractionContent(m),
      messageId: m.messageId,
      occurredAt: new Date(m.receivedAt),
    }))
  );

  return toInsert.length;
}

/**
 * Merge an update_batch (new emails arrived via cron) into the lead it
 * belongs to. Appends as interactions, refreshes updatedAt, then fires the
 * AI reprocess so the user sees suggested followup/priority changes based
 * on the new conversation.
 */
export async function mergeEmailBatch(importId: string) {
  const [row] = await db
    .select()
    .from(pendingEmails)
    .where(eq(pendingEmails.id, importId));
  if (!row) throw new Error("הבאצ' לא נמצא");
  if (row.kind !== "update_batch" || !row.leadId) {
    throw new Error("הפעולה הזו מתאימה רק לבאצ' של עדכונים על ליד קיים");
  }
  if (row.status === "merged" || row.status === "dismissed") {
    redirect(`/leads/${row.leadId}`);
  }

  const messages = (row.messages as StoredEmailMessage[]) ?? [];
  await appendEmailMessagesToLead(row.leadId, messages);

  await db
    .update(leads)
    .set({ updatedAt: new Date() })
    .where(eq(leads.id, row.leadId));

  await db
    .update(pendingEmails)
    .set({
      status: "merged",
      resolvedLeadId: row.leadId,
      resolvedAt: new Date(),
    })
    .where(eq(pendingEmails.id, importId));

  // Trigger reprocess so the AI sees the new messages and can suggest a
  // fresh followup/priority. Wrapped in try — if it fails (rate limit, AI
  // outage) we still want the merge itself to stick.
  try {
    await reprocessLeadWithAi(row.leadId);
  } catch (e) {
    console.error("[email-merge] reprocess after merge failed:", e);
  }

  revalidatePath("/inbox");
  revalidatePath("/queue");
  revalidatePath(`/leads/${row.leadId}`);
  revalidatePath("/");
  redirect(`/leads/${row.leadId}`);
}

const emailApproveSchema = z.object({
  name: z.string().min(1).max(120),
  // Email leads often don't include a phone — allow empty. Minimum 5 only
  // enforced when a value is actually provided.
  phone: z
    .string()
    .max(40)
    .transform((v) => v.trim())
    .refine((v) => v === "" || v.length >= 5, {
      message: "מספר טלפון קצר מדי",
    }),
  language: z.enum(["he", "en", "yi"]),
  audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]),
  status: z.enum(["new", "contacted", "interested", "quoted", "closing", "booked", "lost"]),
  priority: z.enum(["hot", "warm", "cold"]),
  numAdults: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(0).nullish()),
  numChildren: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(0).nullish()),
  agesChildren: z.string().nullish(),
  datesInterest: z.string().nullish(),
  roomTypeInterest: z.string().nullish(),
  budgetSignal: z.preprocess(
    (v) => (v === "" ? null : v),
    z.enum(["low", "mid", "high"]).nullish()
  ),
  interestTags: z.array(z.string()).default([]),
  whatSpokeToThem: z.string().nullish(),
  objections: z.string().nullish(),
  followupAt: z.string().nullish(),
  followupReason: z.string().nullish(),
});

function parseFormToObject(formData: FormData): Record<string, unknown> {
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

/**
 * Approve a new_import email row → create a brand-new lead from the
 * user-edited form values + append the fetched messages as interactions.
 * The email address used for the import is saved as the lead's primary
 * email so the sync cron immediately starts watching it.
 */
export async function approveEmailImport(importId: string, formData: FormData) {
  const parsed = emailApproveSchema.parse(parseFormToObject(formData));
  const [row] = await db
    .select()
    .from(pendingEmails)
    .where(eq(pendingEmails.id, importId));
  if (!row) throw new Error("הייבוא לא נמצא");
  if (row.kind !== "new_import") throw new Error("הפעולה הזו מתאימה רק לייבוא כתובת חדשה");
  if (row.status !== "done") redirect("/inbox");

  const emailAddress = row.emailAddress
    ? normalizeEmailAddress(row.emailAddress)
    : null;
  const messages = (row.messages as StoredEmailMessage[]) ?? [];

  const [created] = await db
    .insert(leads)
    .values({
      name: parsed.name,
      phone: parsed.phone,
      email: emailAddress,
      language: parsed.language,
      audience: parsed.audience,
      channelFirst: "email",
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

  await appendEmailMessagesToLead(created.id, messages);

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
    .update(pendingEmails)
    .set({
      status: "merged",
      resolvedLeadId: created.id,
      resolvedAt: new Date(),
    })
    .where(eq(pendingEmails.id, importId));

  revalidatePath("/inbox");
  revalidatePath("/queue");
  revalidatePath("/leads");
  revalidatePath("/");
  redirect(`/leads/${created.id}`);
}

const emailMergeSchema = emailApproveSchema
  .omit({ name: true, phone: true })
  .extend({ leadId: z.string().uuid() });

/**
 * Merge a new_import email row into an existing lead. The email address from
 * the import is added to aliasEmails (if it differs from the existing
 * primary). Messages are appended as interactions. Triggers reprocess.
 */
export async function mergeEmailImport(importId: string, formData: FormData) {
  const parsed = emailMergeSchema.parse(parseFormToObject(formData));
  const [row] = await db
    .select()
    .from(pendingEmails)
    .where(eq(pendingEmails.id, importId));
  if (!row) throw new Error("הייבוא לא נמצא");
  if (row.kind !== "new_import") throw new Error("הפעולה הזו מתאימה רק לייבוא כתובת חדשה");
  if (row.status !== "done") redirect("/inbox");

  const [existing] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, parsed.leadId));
  if (!existing) throw new Error("הליד לא נמצא");

  const emailAddress = row.emailAddress
    ? normalizeEmailAddress(row.emailAddress)
    : null;

  // Add the imported address to watchlist: primary if empty, else alias.
  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (emailAddress) {
    if (!existing.email) {
      updateFields.email = emailAddress;
    } else if (
      normalizeEmailAddress(existing.email) !== emailAddress &&
      !existing.aliasEmails.includes(emailAddress)
    ) {
      updateFields.aliasEmails = [...existing.aliasEmails, emailAddress];
    }
  }

  // Fill-if-empty semantics — never overwrite data already on the lead.
  const fillIfEmpty = (field: string, current: unknown, next: unknown) => {
    if (next == null || next === "") return;
    if (current != null && current !== "") return;
    updateFields[field] = next;
  };
  fillIfEmpty("numAdults", existing.numAdults, parsed.numAdults);
  fillIfEmpty("numChildren", existing.numChildren, parsed.numChildren);
  fillIfEmpty("agesChildren", existing.agesChildren, parsed.agesChildren);
  fillIfEmpty("datesInterest", existing.datesInterest, parsed.datesInterest);
  fillIfEmpty("roomTypeInterest", existing.roomTypeInterest, parsed.roomTypeInterest);
  fillIfEmpty("budgetSignal", existing.budgetSignal, parsed.budgetSignal);
  fillIfEmpty("whatSpokeToThem", existing.whatSpokeToThem, parsed.whatSpokeToThem);
  fillIfEmpty("objections", existing.objections, parsed.objections);

  // Status/priority advance only — never regress.
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
    updateFields.status = parsed.status;
  }
  if (
    (PRIORITY_RANK[parsed.priority] ?? -1) > (PRIORITY_RANK[existing.priority] ?? -1)
  ) {
    updateFields.priority = parsed.priority;
  }

  const mergedTags = Array.from(
    new Set([...(existing.interestTags ?? []), ...parsed.interestTags])
  );
  if (mergedTags.length !== (existing.interestTags ?? []).length) {
    updateFields.interestTags = mergedTags;
  }

  await db.update(leads).set(updateFields).where(eq(leads.id, parsed.leadId));

  const messages = (row.messages as StoredEmailMessage[]) ?? [];
  await appendEmailMessagesToLead(parsed.leadId, messages);

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
    .update(pendingEmails)
    .set({
      status: "merged",
      resolvedLeadId: parsed.leadId,
      resolvedAt: new Date(),
    })
    .where(eq(pendingEmails.id, importId));

  // Trigger reprocess so AI considers the new email content.
  try {
    await reprocessLeadWithAi(parsed.leadId);
  } catch (e) {
    console.error("[email-merge-import] reprocess after merge failed:", e);
  }

  revalidatePath("/inbox");
  revalidatePath("/queue");
  revalidatePath("/leads");
  revalidatePath(`/leads/${parsed.leadId}`);
  revalidatePath("/");
  redirect(`/leads/${parsed.leadId}`);
}

