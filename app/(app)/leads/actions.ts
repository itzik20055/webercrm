"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, leads, followups, interactions } from "@/db";
import { and, eq, sql } from "drizzle-orm";

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
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  };
  const parsed = createSchema.parse(raw);

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
      notes: parsed.notes,
    })
    .returning({ id: leads.id });

  revalidatePath("/leads");
  revalidatePath("/");
  redirect(`/leads/${created.id}`);
}

const updateSchema = z.object({
  id: z.string().uuid(),
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

  const { id, ...rest } = parsed;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    update[k] = nullify(v as string | number | null);
  }

  await db.update(leads).set(update).where(eq(leads.id, id));
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
  revalidatePath("/");
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
  revalidatePath("/");
}
