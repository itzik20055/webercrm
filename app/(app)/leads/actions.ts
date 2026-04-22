"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  db,
  leads,
  followups,
  interactions,
  pendingWhatsAppImports,
  type Lead,
} from "@/db";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { reprocessLeadProfile } from "@/lib/ai-client";
import { getSetting } from "@/lib/settings";
import { phoneTail } from "@/lib/phone";

async function supersedeOpenFollowups(leadId: string, exceptId?: string) {
  const cond = exceptId
    ? and(
        eq(followups.leadId, leadId),
        isNull(followups.completedAt),
        ne(followups.id, exceptId)
      )
    : and(eq(followups.leadId, leadId), isNull(followups.completedAt));
  await db.update(followups).set({ completedAt: new Date() }).where(cond);
}

const createSchema = z.object({
  name: z.string().min(1, "שם חובה").max(120),
  phone: z.string().min(5, "מספר טלפון חובה").max(40),
  email: z.string().email().optional().or(z.literal("")),
  language: z.enum(["he", "en", "yi"]).default("he"),
  audience: z
    .enum(["israeli_haredi", "american_haredi", "european_haredi"])
    .default("israeli_haredi"),
  channelFirst: z
    .enum(["call", "whatsapp", "email", "referral", "other"])
    .default("whatsapp"),
  source: z.string().max(120).optional(),
  previousStays: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export async function createLead(formData: FormData) {
  const raw = {
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim() || undefined,
    language: (formData.get("language") || "he") as "he" | "en" | "yi",
    audience: (formData.get("audience") || "israeli_haredi") as
      | "israeli_haredi"
      | "american_haredi"
      | "european_haredi",
    channelFirst: (formData.get("channelFirst") || "whatsapp") as
      | "call"
      | "whatsapp"
      | "email"
      | "referral"
      | "other",
    source: String(formData.get("source") ?? "").trim() || undefined,
    previousStays:
      String(formData.get("previousStays") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  };
  const parsed = createSchema.parse(raw);

  const tail = phoneTail(parsed.phone);
  if (tail.length >= 7) {
    const [dup] = await db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(
        sql`right(regexp_replace(${leads.phone}, '\D', '', 'g'), 9) = ${tail}`
      )
      .limit(1);
    if (dup) {
      throw new Error(
        `כבר קיים ליד בשם "${dup.name}" עם הטלפון הזה. פתח אותו במקום ליצור חדש.`
      );
    }
  }

  const [created] = await db
    .insert(leads)
    .values({
      name: parsed.name,
      phone: parsed.phone,
      email: parsed.email,
      language: parsed.language,
      audience: parsed.audience,
      channelFirst: parsed.channelFirst,
      source: parsed.source,
      previousStays: parsed.previousStays,
      notes: parsed.notes,
    })
    .returning({ id: leads.id });

  revalidatePath("/leads");
  revalidatePath("/");
  redirect(`/leads/${created.id}`);
}

const updateSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.coerce.date(),
  name: z.string().min(1).max(120).optional(),
  phone: z.string().min(5).max(40).optional(),
  email: z.string().email().nullish().or(z.literal("")),
  language: z.enum(["he", "en", "yi"]).optional(),
  audience: z
    .enum(["israeli_haredi", "american_haredi", "european_haredi"])
    .optional(),
  channelFirst: z
    .enum(["call", "whatsapp", "email", "referral", "other"])
    .optional(),
  status: z
    .enum([
      "new",
      "contacted",
      "interested",
      "quoted",
      "closing",
      "booked",
      "lost",
    ])
    .optional(),
  priority: z.enum(["hot", "warm", "cold"]).optional(),
  numAdults: z.coerce.number().int().min(0).nullish(),
  numChildren: z.coerce.number().int().min(0).nullish(),
  agesChildren: z.string().max(120).nullish(),
  datesInterest: z.string().max(120).nullish(),
  roomTypeInterest: z.string().max(120).nullish(),
  buildingPref: z.enum(["a", "b", "any"]).nullish(),
  budgetSignal: z.enum(["low", "mid", "high"]).nullish(),
  whatSpokeToThem: z.string().max(1000).nullish(),
  objections: z.string().max(1000).nullish(),
  source: z.string().max(120).nullish(),
  previousStays: z.string().max(500).nullish(),
  notes: z.string().max(4000).nullish(),
  lostReason: z.string().max(500).nullish(),
});

function nullify<T>(v: T | "" | undefined | null) {
  if (v === undefined || v === null || v === "") return null;
  return v;
}

export async function updateLead(formData: FormData) {
  const obj: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    obj[key] = value;
  });
  const parsed = updateSchema.parse(obj);

  const { id, expectedUpdatedAt, ...rest } = parsed;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    update[k] = nullify(v as string | number | null);
  }

  const updated = await db
    .update(leads)
    .set(update)
    .where(and(eq(leads.id, id), eq(leads.updatedAt, expectedUpdatedAt)))
    .returning({ id: leads.id });

  if (updated.length === 0) {
    throw new Error(
      "הליד עודכן ממקום אחר בזמן שערכת אותו. רענן את הדף ונסה שוב."
    );
  }

  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  revalidatePath("/");
}

export async function setStatus(id: string, status: string) {
  const valid = [
    "new",
    "contacted",
    "interested",
    "quoted",
    "closing",
    "booked",
    "lost",
  ] as const;
  if (!valid.includes(status as (typeof valid)[number])) {
    throw new Error("Invalid status");
  }
  await db
    .update(leads)
    .set({ status: status as (typeof valid)[number], updatedAt: new Date() })
    .where(eq(leads.id, id));
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  revalidatePath("/");
}

export async function setPriority(id: string, priority: "hot" | "warm" | "cold") {
  await db
    .update(leads)
    .set({ priority, updatedAt: new Date() })
    .where(eq(leads.id, id));
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
}

export async function toggleInterestTag(id: string, tag: string) {
  const [row] = await db
    .select({ tags: leads.interestTags })
    .from(leads)
    .where(eq(leads.id, id));
  if (!row) return;
  const has = row.tags.includes(tag);
  const next = has ? row.tags.filter((t) => t !== tag) : [...row.tags, tag];
  await db
    .update(leads)
    .set({ interestTags: next, updatedAt: new Date() })
    .where(eq(leads.id, id));
  revalidatePath(`/leads/${id}`);
}

export async function deleteLead(id: string) {
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/leads");
  revalidatePath("/");
  redirect("/leads");
}

const interactionSchema = z.object({
  leadId: z.string().uuid(),
  type: z.enum(["call_in", "call_out", "whatsapp", "email", "sms", "note"]),
  direction: z.enum(["in", "out", "internal"]).default("in"),
  content: z.string().min(1).max(8000),
  durationMin: z.coerce.number().int().min(0).optional().nullable(),
});

export async function logInteraction(formData: FormData) {
  const parsed = interactionSchema.parse({
    leadId: formData.get("leadId"),
    type: formData.get("type"),
    direction: formData.get("direction"),
    content: formData.get("content"),
    durationMin: formData.get("durationMin") || null,
  });

  await db.insert(interactions).values({
    leadId: parsed.leadId,
    type: parsed.type,
    direction: parsed.direction,
    content: parsed.content,
    durationMin: parsed.durationMin ?? null,
  });

  await db
    .update(leads)
    .set({
      updatedAt: new Date(),
      status: sql`case when ${leads.status} = 'new' then 'contacted'::lead_status else ${leads.status} end`,
    })
    .where(eq(leads.id, parsed.leadId));

  revalidatePath(`/leads/${parsed.leadId}`);
  revalidatePath("/");
}

const followupSchema = z.object({
  leadId: z.string().uuid(),
  dueAt: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function scheduleFollowup(formData: FormData) {
  const parsed = followupSchema.parse({
    leadId: formData.get("leadId"),
    dueAt: formData.get("dueAt"),
    reason: formData.get("reason") || undefined,
  });
  const due = new Date(parsed.dueAt);
  if (isNaN(due.getTime())) throw new Error("Invalid date");
  if (due.getTime() < Date.now() - 60_000) {
    throw new Error("תאריך עבר — בחר מועד עתידי");
  }

  await supersedeOpenFollowups(parsed.leadId);
  await db.insert(followups).values({
    leadId: parsed.leadId,
    dueAt: due,
    reason: parsed.reason ?? null,
  });
  await db
    .update(leads)
    .set({
      nextFollowupAt: due,
      followupCompletedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, parsed.leadId));

  revalidatePath(`/leads/${parsed.leadId}`);
  revalidatePath("/followups");
  revalidatePath("/queue");
  revalidatePath("/");
}

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? null : v), schema);

const importSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(40),
  language: z.enum(["he", "en", "yi"]),
  audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]),
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
  // Logged content
  chatTranscript: z.string().min(1),
  // Optional followup
  followupAt: z.string().nullish(),
  followupReason: z.string().nullish(),
  // If set, mark that pending_whatsapp_imports row as resolved.
  pendingImportId: z.string().uuid().nullish(),
});

async function resolvePendingImport(pendingId: string | null | undefined, leadId: string) {
  if (!pendingId) return;
  await db
    .update(pendingWhatsAppImports)
    .set({
      status: "merged",
      resolvedLeadId: leadId,
      resolvedAt: new Date(),
    })
    .where(eq(pendingWhatsAppImports.id, pendingId));
}

export async function createLeadFromImport(formData: FormData) {
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
  const parsed = importSchema.parse(obj);

  const [created] = await db
    .insert(leads)
    .values({
      name: parsed.name,
      phone: parsed.phone,
      language: parsed.language,
      audience: parsed.audience,
      channelFirst: "whatsapp",
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
    type: "whatsapp",
    direction: "internal",
    content: parsed.chatTranscript,
    aiSummary: parsed.whatSpokeToThem ?? null,
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

  await resolvePendingImport(parsed.pendingImportId, created.id);

  revalidatePath("/leads");
  revalidatePath("/inbox");
  revalidatePath("/");
  redirect(`/leads/${created.id}`);
}

const mergeImportSchema = z.object({
  leadId: z.string().uuid(),
  // Optional updates — only applied if non-empty (we don't overwrite existing data)
  language: z.enum(["he", "en", "yi"]).optional(),
  audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]).optional(),
  status: z
    .enum(["new", "contacted", "interested", "quoted", "closing", "booked", "lost"])
    .optional(),
  priority: z.enum(["hot", "warm", "cold"]).optional(),
  numAdults: emptyToNull(z.coerce.number().int().min(0).nullish()),
  numChildren: emptyToNull(z.coerce.number().int().min(0).nullish()),
  agesChildren: z.string().nullish(),
  datesInterest: z.string().nullish(),
  roomTypeInterest: z.string().nullish(),
  budgetSignal: emptyToNull(z.enum(["low", "mid", "high"]).nullish()),
  interestTags: z.array(z.string()).default([]),
  whatSpokeToThem: z.string().nullish(),
  objections: z.string().nullish(),
  chatTranscript: z.string().min(1),
  followupAt: z.string().nullish(),
  followupReason: z.string().nullish(),
  pendingImportId: z.string().uuid().nullish(),
});

export async function mergeImportIntoLead(formData: FormData) {
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
  const parsed = mergeImportSchema.parse(obj);

  const [existing] = await db.select().from(leads).where(eq(leads.id, parsed.leadId));
  if (!existing) throw new Error("הליד לא נמצא");

  // Merge tags (union)
  const mergedTags = Array.from(
    new Set([...(existing.interestTags ?? []), ...parsed.interestTags])
  );

  // For trip details, prefer the new value only if it's a non-empty string
  // and the existing field is null. Don't overwrite existing data silently.
  const update: Record<string, unknown> = {
    updatedAt: new Date(),
    interestTags: mergedTags,
  };
  if (parsed.status) update.status = parsed.status;
  if (parsed.priority) update.priority = parsed.priority;
  if (parsed.language) update.language = parsed.language;
  if (parsed.audience) update.audience = parsed.audience;

  const fillIfEmpty = <K extends keyof typeof existing>(
    field: K,
    next: unknown
  ) => {
    if ((existing as Record<string, unknown>)[field as string] == null && next != null && next !== "") {
      update[field as string] = next;
    }
  };
  fillIfEmpty("numAdults", parsed.numAdults);
  fillIfEmpty("numChildren", parsed.numChildren);
  fillIfEmpty("agesChildren", parsed.agesChildren);
  fillIfEmpty("datesInterest", parsed.datesInterest);
  fillIfEmpty("roomTypeInterest", parsed.roomTypeInterest);
  fillIfEmpty("budgetSignal", parsed.budgetSignal);
  fillIfEmpty("whatSpokeToThem", parsed.whatSpokeToThem);
  fillIfEmpty("objections", parsed.objections);

  await db.update(leads).set(update).where(eq(leads.id, parsed.leadId));

  // Dedup: WhatsApp re-exports are deterministic supersets of prior exports.
  // If the new chat contains a previous upload verbatim, strip that prefix
  // and only persist the delta. Otherwise we'd multiply historical messages
  // every time the user re-imports the chat to capture new replies.
  const priorUploads = await db
    .select({ content: interactions.content })
    .from(interactions)
    .where(
      and(eq(interactions.leadId, parsed.leadId), eq(interactions.type, "whatsapp"))
    )
    .orderBy(desc(interactions.occurredAt), desc(interactions.id));

  let newContent = parsed.chatTranscript;
  for (const p of priorUploads) {
    if (!p.content) continue;
    const idx = newContent.indexOf(p.content);
    if (idx >= 0) {
      newContent = newContent.slice(idx + p.content.length).replace(/^\s+/, "");
    }
  }

  if (newContent.length > 0) {
    await db.insert(interactions).values({
      leadId: parsed.leadId,
      type: "whatsapp",
      direction: "internal",
      content: newContent,
      aiSummary: parsed.whatSpokeToThem ?? null,
    });
  }

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
        .set({ nextFollowupAt: due, followupCompletedAt: null, updatedAt: new Date() })
        .where(eq(leads.id, parsed.leadId));
    }
  }

  await resolvePendingImport(parsed.pendingImportId, parsed.leadId);

  revalidatePath("/leads");
  revalidatePath("/inbox");
  revalidatePath(`/leads/${parsed.leadId}`);
  revalidatePath("/");
  redirect(`/leads/${parsed.leadId}`);
}

export async function completeFollowup(followupId: string, leadId: string) {
  await db
    .update(followups)
    .set({ completedAt: new Date() })
    .where(eq(followups.id, followupId));

  const [next] = await db
    .select({ dueAt: followups.dueAt })
    .from(followups)
    .where(and(eq(followups.leadId, leadId), sql`${followups.completedAt} is null`))
    .orderBy(followups.dueAt)
    .limit(1);

  await db
    .update(leads)
    .set({
      nextFollowupAt: next?.dueAt ?? null,
      followupCompletedAt: next ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/followups");
  revalidatePath("/queue");
  revalidatePath("/");
}

const resolveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("next"),
    followupId: z.string().uuid(),
    leadId: z.string().uuid(),
    dueAt: z.string().min(1),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("booked"),
    followupId: z.string().uuid(),
    leadId: z.string().uuid(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("lost"),
    followupId: z.string().uuid(),
    leadId: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }),
]);

export async function resolveFollowup(formData: FormData) {
  const raw: Record<string, unknown> = {};
  formData.forEach((v, k) => {
    raw[k] = v;
  });
  const parsed = resolveSchema.parse(raw);

  await db
    .update(followups)
    .set({ completedAt: new Date() })
    .where(eq(followups.id, parsed.followupId));

  if (parsed.action === "next") {
    const due = new Date(parsed.dueAt);
    if (isNaN(due.getTime())) throw new Error("Invalid date");
    if (due.getTime() < Date.now() - 60_000) {
      throw new Error("תאריך עבר — בחר מועד עתידי");
    }
    await supersedeOpenFollowups(parsed.leadId, parsed.followupId);
    await db.insert(followups).values({
      leadId: parsed.leadId,
      dueAt: due,
      reason: parsed.reason ?? null,
    });
    await db
      .update(leads)
      .set({
        nextFollowupAt: due,
        followupCompletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, parsed.leadId));
  } else if (parsed.action === "booked") {
    const update: Record<string, unknown> = {
      status: "booked" as const,
      nextFollowupAt: null,
      followupCompletedAt: new Date(),
      updatedAt: new Date(),
    };
    if (parsed.note) {
      const [existing] = await db.select({ notes: leads.notes }).from(leads).where(eq(leads.id, parsed.leadId));
      const ts = new Date().toLocaleDateString("he-IL");
      const line = `[${ts}] נסגר: ${parsed.note}`;
      update.notes = existing?.notes ? `${existing.notes}\n${line}` : line;
    }
    await db.update(leads).set(update).where(eq(leads.id, parsed.leadId));
  } else if (parsed.action === "lost") {
    await db
      .update(leads)
      .set({
        status: "lost" as const,
        lostReason: parsed.reason ?? null,
        nextFollowupAt: null,
        followupCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, parsed.leadId));
  }

  revalidatePath(`/leads/${parsed.leadId}`);
  revalidatePath("/followups");
  revalidatePath("/queue");
  revalidatePath("/");
}

// --- Batch interaction logging + AI reprocess ---

const batchInteractionRowSchema = z.object({
  type: z.enum(["call_in", "call_out", "whatsapp", "email", "sms", "note"]),
  direction: z.enum(["in", "out", "internal"]),
  content: z.string().min(1).max(8000),
  durationMin: z.coerce.number().int().min(0).nullish(),
  occurredAt: z.string().nullish(),
});

/**
 * Saves multiple interaction rows in one call. Used by the multi-message log
 * form — the user types a stack of back-and-forth messages and we persist them
 * as individual interactions. No AI call runs here: the user triggers reprocess
 * separately via the "עיבוד עם AI" button on the lead page.
 */
export async function logInteractionsBatch(formData: FormData) {
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) throw new Error("leadId missing");

  const rawRows = formData.getAll("rows");
  if (rawRows.length === 0) throw new Error("אין הודעות לשמור");

  const parsed = rawRows.map((r) => {
    try {
      const obj = JSON.parse(String(r));
      return batchInteractionRowSchema.parse(obj);
    } catch {
      throw new Error("שורת הודעה לא תקינה");
    }
  });

  const baseNow = Date.now();
  const values = parsed.map((row, i) => ({
    leadId,
    type: row.type,
    direction: row.direction,
    content: row.content,
    durationMin: row.durationMin ?? null,
    occurredAt: row.occurredAt ? new Date(row.occurredAt) : new Date(baseNow + i),
  }));

  await db.insert(interactions).values(values);

  await db
    .update(leads)
    .set({
      updatedAt: new Date(),
      status: sql`case when ${leads.status} = 'new' then 'contacted'::lead_status else ${leads.status} end`,
    })
    .where(eq(leads.id, leadId));

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
}

/**
 * Fields that get snapshotted before an AI reprocess and restored on undo.
 * These are exactly the fields the reprocess prompt is allowed to change —
 * customer-identity fields (name/phone/email/language/audience/channel/source)
 * are user-owned and never touched.
 */
export interface ReprocessSnapshot {
  numAdults: number | null;
  numChildren: number | null;
  agesChildren: string | null;
  datesInterest: string | null;
  roomTypeInterest: string | null;
  budgetSignal: Lead["budgetSignal"];
  interestTags: string[];
  whatSpokeToThem: string | null;
  objections: string | null;
  status: Lead["status"];
  priority: Lead["priority"];
}

export type PendingFollowupSuggestion =
  | {
      action: "reschedule";
      dueAt: string;
      reason: string | null;
      reasoning: string;
    }
  | {
      action: "cancel";
      reasoning: string;
    };

export type PendingPrioritySuggestion = {
  from: Lead["priority"];
  to: Lead["priority"];
};

function buildSnapshot(lead: Lead): ReprocessSnapshot {
  return {
    numAdults: lead.numAdults,
    numChildren: lead.numChildren,
    agesChildren: lead.agesChildren,
    datesInterest: lead.datesInterest,
    roomTypeInterest: lead.roomTypeInterest,
    budgetSignal: lead.budgetSignal,
    interestTags: lead.interestTags ?? [],
    whatSpokeToThem: lead.whatSpokeToThem,
    objections: lead.objections,
    status: lead.status,
    priority: lead.priority,
  };
}

export interface ReprocessResult {
  ok: true;
  changeNotes: string;
  followupSuggestion: PendingFollowupSuggestion | null;
  prioritySuggestion: PendingPrioritySuggestion | null;
}

/**
 * Matches the client-side undo banner window in components/lead-ai-reprocess.tsx.
 * Keep them in sync — if the client window ever changes, this constant must too.
 */
const REPROCESS_LOCK_MS = 30_000;

/**
 * Runs the full conversation + profile through the AI and applies the resulting
 * field updates to the lead. Snapshots the old values for a 30s undo window.
 * Followup changes are NOT applied here — they're stashed in
 * pendingFollowupSuggestion for the user to approve separately on the lead page.
 */
export async function reprocessLeadWithAi(leadId: string): Promise<ReprocessResult> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error("הליד לא נמצא");

  if (lead.lastReprocessedAt) {
    const sinceLast = Date.now() - lead.lastReprocessedAt.getTime();
    if (sinceLast < REPROCESS_LOCK_MS) {
      const remaining = Math.ceil((REPROCESS_LOCK_MS - sinceLast) / 1000);
      throw new Error(
        `המתן ${remaining} שניות (חלון ביטול), או בטל את העיבוד הקודם`
      );
    }
  }

  const [allInteractions, openFollowupsRows] = await Promise.all([
    db
      .select()
      .from(interactions)
      .where(eq(interactions.leadId, leadId))
      .orderBy(asc(interactions.occurredAt), asc(interactions.id)),
    db
      .select()
      .from(followups)
      .where(and(eq(followups.leadId, leadId), isNull(followups.completedAt)))
      .orderBy(asc(followups.dueAt))
      .limit(1),
  ]);

  if (allInteractions.length === 0) {
    throw new Error("אין שיחות לעבד — תעד קודם");
  }

  const ourName = (await getSetting("whatsapp_display_name")) ?? "איציק";
  const { profile } = await reprocessLeadProfile({
    lead,
    interactions: allInteractions,
    openFollowup: openFollowupsRows[0]
      ? { dueAt: openFollowupsRows[0].dueAt, reason: openFollowupsRows[0].reason }
      : null,
    ourName,
  });

  const snapshot = buildSnapshot(lead);

  let followupSuggestion: PendingFollowupSuggestion | null = null;
  if (profile.followupAction === "reschedule" && profile.followupHoursFromNow != null) {
    const due = new Date(
      Date.now() + profile.followupHoursFromNow * 60 * 60 * 1000
    );
    followupSuggestion = {
      action: "reschedule",
      dueAt: due.toISOString(),
      reason: profile.followupReason,
      reasoning: profile.followupReasoning,
    };
  } else if (profile.followupAction === "cancel") {
    followupSuggestion = {
      action: "cancel",
      reasoning: profile.followupReasoning,
    };
  }

  const prioritySuggestion: PendingPrioritySuggestion | null =
    profile.priority !== lead.priority
      ? { from: lead.priority, to: profile.priority }
      : null;

  await db
    .update(leads)
    .set({
      numAdults: profile.numAdults,
      numChildren: profile.numChildren,
      agesChildren: profile.agesChildren,
      datesInterest: profile.datesInterest,
      roomTypeInterest: profile.roomTypeInterest,
      budgetSignal: profile.budgetSignal,
      interestTags: profile.interestTags,
      whatSpokeToThem: profile.whatSpokeToThem,
      objections: profile.objections,
      status: profile.status,
      lastReprocessSnapshot: snapshot,
      lastReprocessedAt: new Date(),
      pendingFollowupSuggestion: followupSuggestion,
      pendingPrioritySuggestion: prioritySuggestion,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/");

  return {
    ok: true,
    changeNotes: profile.changeNotes,
    followupSuggestion,
    prioritySuggestion,
  };
}

/**
 * Restores the snapshot captured by the last reprocess. Clears the snapshot +
 * the pending followup suggestion. No-op if no snapshot exists (stale click).
 */
export async function undoLastReprocess(leadId: string): Promise<void> {
  const [lead] = await db
    .select({
      lastReprocessSnapshot: leads.lastReprocessSnapshot,
    })
    .from(leads)
    .where(eq(leads.id, leadId));

  if (!lead?.lastReprocessSnapshot) return;

  const snap = lead.lastReprocessSnapshot as ReprocessSnapshot;
  await db
    .update(leads)
    .set({
      numAdults: snap.numAdults,
      numChildren: snap.numChildren,
      agesChildren: snap.agesChildren,
      datesInterest: snap.datesInterest,
      roomTypeInterest: snap.roomTypeInterest,
      budgetSignal: snap.budgetSignal,
      interestTags: snap.interestTags ?? [],
      whatSpokeToThem: snap.whatSpokeToThem,
      objections: snap.objections,
      status: snap.status,
      priority: snap.priority,
      lastReprocessSnapshot: null,
      lastReprocessedAt: null,
      pendingFollowupSuggestion: null,
      pendingPrioritySuggestion: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/");
}

/**
 * Approves the AI's followup suggestion: either schedules a new followup at
 * the proposed time (reschedule) or marks all open followups complete
 * (cancel). Either way, the pending suggestion is cleared.
 */
export async function applyFollowupSuggestion(leadId: string): Promise<void> {
  const [lead] = await db
    .select({ pendingFollowupSuggestion: leads.pendingFollowupSuggestion })
    .from(leads)
    .where(eq(leads.id, leadId));
  if (!lead?.pendingFollowupSuggestion) return;

  const sug = lead.pendingFollowupSuggestion as PendingFollowupSuggestion;

  if (sug.action === "reschedule") {
    const due = new Date(sug.dueAt);
    if (isNaN(due.getTime())) throw new Error("תאריך פולואפ לא תקין");
    await supersedeOpenFollowups(leadId);
    await db.insert(followups).values({
      leadId,
      dueAt: due,
      reason: sug.reason ?? null,
    });
    await db
      .update(leads)
      .set({
        nextFollowupAt: due,
        followupCompletedAt: null,
        pendingFollowupSuggestion: null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
  } else {
    await supersedeOpenFollowups(leadId);
    await db
      .update(leads)
      .set({
        nextFollowupAt: null,
        followupCompletedAt: new Date(),
        pendingFollowupSuggestion: null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/followups");
  revalidatePath("/queue");
  revalidatePath("/");
}

export async function dismissFollowupSuggestion(leadId: string): Promise<void> {
  await db
    .update(leads)
    .set({ pendingFollowupSuggestion: null, updatedAt: new Date() })
    .where(eq(leads.id, leadId));
  revalidatePath(`/leads/${leadId}`);
}

/**
 * Approves the AI's priority suggestion: flips the lead's priority to the
 * proposed value and clears the suggestion.
 */
export async function applyPrioritySuggestion(leadId: string): Promise<void> {
  const [lead] = await db
    .select({ pendingPrioritySuggestion: leads.pendingPrioritySuggestion })
    .from(leads)
    .where(eq(leads.id, leadId));
  if (!lead?.pendingPrioritySuggestion) return;

  const sug = lead.pendingPrioritySuggestion as PendingPrioritySuggestion;

  await db
    .update(leads)
    .set({
      priority: sug.to,
      pendingPrioritySuggestion: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/");
}

export async function dismissPrioritySuggestion(leadId: string): Promise<void> {
  await db
    .update(leads)
    .set({ pendingPrioritySuggestion: null, updatedAt: new Date() })
    .where(eq(leads.id, leadId));
  revalidatePath(`/leads/${leadId}`);
}
