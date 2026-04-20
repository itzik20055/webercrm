"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, leads, followups, interactions } from "@/db";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { extractLeadFromChat, type ExtractedLead } from "@/lib/ai-client";
import { getSetting } from "@/lib/settings";
import { extractPhones } from "@/lib/phone";

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

export async function getLeadCapsule(id: string): Promise<
  | { ok: true; lead: { id: string; name: string; phone: string; status: string } }
  | { ok: false }
> {
  const [row] = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      status: leads.status,
    })
    .from(leads)
    .where(eq(leads.id, id))
    .limit(1);
  if (!row) return { ok: false };
  return { ok: true, lead: row };
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

export type LeadMatch = {
  id: string;
  name: string;
  phone: string;
  status: "new" | "contacted" | "interested" | "quoted" | "closing" | "booked" | "lost";
  updatedAt: Date;
};

export type FindLeadsResult = {
  phones: string[];
  matches: LeadMatch[];
  recent: LeadMatch[];
};

export async function findLeadsForCapture(text: string): Promise<FindLeadsResult> {
  const trimmed = (text ?? "").slice(0, 8000);
  const phones = extractPhones(trimmed);

  let matches: LeadMatch[] = [];
  if (phones.length > 0) {
    const conds = phones
      .map((p) => p.replace(/\D/g, "").slice(-9))
      .filter((tail) => tail.length >= 7)
      .map(
        (tail) =>
          sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9) = ${tail}`
      );
    if (conds.length > 0) {
      matches = await db
        .select({
          id: leads.id,
          name: leads.name,
          phone: leads.phone,
          status: leads.status,
          updatedAt: leads.updatedAt,
        })
        .from(leads)
        .where(conds.length === 1 ? conds[0] : sql.join(conds, sql` or `))
        .orderBy(desc(leads.updatedAt))
        .limit(5);
    }
  }

  const recent = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      status: leads.status,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .orderBy(desc(leads.updatedAt))
    .limit(8);

  return { phones, matches, recent };
}

const captureSchema = z.object({
  leadId: z.string().uuid(),
  type: z
    .enum(["call_in", "call_out", "whatsapp", "email", "sms", "note"])
    .default("whatsapp"),
  direction: z.enum(["in", "out", "internal"]).default("in"),
  content: z.string().min(1).max(8000),
  durationMin: z.coerce.number().int().min(0).optional().nullable(),
});

export type CaptureSuggestions = {
  whatSpokeToThem?: { current: string | null; next: string };
  objections?: { current: string | null; next: string };
  numAdults?: { current: number | null; next: number };
  numChildren?: { current: number | null; next: number };
  agesChildren?: { current: string | null; next: string };
  datesInterest?: { current: string | null; next: string };
  roomTypeInterest?: { current: string | null; next: string };
  budgetSignal?: { current: "low" | "mid" | "high" | null; next: "low" | "mid" | "high" };
  status?: {
    current: "new" | "contacted" | "interested" | "quoted" | "closing" | "booked" | "lost";
    next: "new" | "contacted" | "interested" | "quoted" | "closing" | "booked" | "lost";
  };
  priority?: { current: "hot" | "warm" | "cold"; next: "hot" | "warm" | "cold" };
  language?: { current: "he" | "en" | "yi"; next: "he" | "en" | "yi" };
  audience?: {
    current: "israeli_haredi" | "american_haredi" | "european_haredi";
    next: "israeli_haredi" | "american_haredi" | "european_haredi";
  };
  newTags?: string[];
  followup?: { dueAt: string; reason: string | null; reasoning: string };
  summary?: string;
};

export type CaptureAndAnalyzeResult =
  | { ok: true; interactionId: string; suggestions: CaptureSuggestions }
  | { ok: false; interactionId?: string; error: string };

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

export async function captureAndAnalyze(input: {
  leadId: string;
  type: "call_in" | "call_out" | "whatsapp" | "email" | "sms" | "note";
  direction: "in" | "out" | "internal";
  content: string;
  durationMin?: number | null;
}): Promise<CaptureAndAnalyzeResult> {
  let interactionId: string | undefined;
  try {
    const parsed = captureSchema.parse(input);
    const [lead] = await db.select().from(leads).where(eq(leads.id, parsed.leadId));
    if (!lead) return { ok: false, error: "ליד לא נמצא" };

    const [created] = await db
      .insert(interactions)
      .values({
        leadId: parsed.leadId,
        type: parsed.type,
        direction: parsed.direction,
        content: parsed.content,
        durationMin: parsed.durationMin ?? null,
      })
      .returning({ id: interactions.id });
    interactionId = created.id;

    await db
      .update(leads)
      .set({
        updatedAt: new Date(),
        status: sql`case when ${leads.status} = 'new' then 'contacted'::lead_status else ${leads.status} end`,
      })
      .where(eq(leads.id, parsed.leadId));

    revalidatePath(`/leads/${parsed.leadId}`);
    revalidatePath("/");

    const ourName = (await getSetting("whatsapp_display_name")) ?? "Me";
    const recent = await db
      .select({ content: interactions.content, direction: interactions.direction })
      .from(interactions)
      .where(eq(interactions.leadId, parsed.leadId))
      .orderBy(desc(interactions.occurredAt))
      .limit(8);

    const transcript = recent
      .slice()
      .reverse()
      .map((i) => {
        const speaker = i.direction === "out" ? ourName : i.direction === "in" ? lead.name : "[note]";
        return `${speaker}: ${i.content}`;
      })
      .join("\n\n");

    let extracted: ExtractedLead;
    try {
      const res = await extractLeadFromChat({
        chatText: transcript,
        leadName: lead.name,
        ourName,
        knownLeadId: lead.id,
      });
      extracted = res.lead;
    } catch (e) {
      return {
        ok: true,
        interactionId,
        suggestions: { summary: e instanceof Error ? e.message : "ניתוח נכשל" },
      };
    }

    const s: CaptureSuggestions = {};
    if (extracted.summary) s.summary = extracted.summary;

    const fillIfEmpty = <K extends keyof CaptureSuggestions>(
      key: K,
      current: unknown,
      next: unknown
    ) => {
      if (next == null || next === "") return;
      if (current != null && current !== "") return;
      (s as Record<string, unknown>)[key] = { current: current ?? null, next };
    };
    fillIfEmpty("whatSpokeToThem", lead.whatSpokeToThem, extracted.whatSpokeToThem);
    fillIfEmpty("objections", lead.objections, extracted.objections);
    fillIfEmpty("numAdults", lead.numAdults, extracted.numAdults);
    fillIfEmpty("numChildren", lead.numChildren, extracted.numChildren);
    fillIfEmpty("agesChildren", lead.agesChildren, extracted.agesChildren);
    fillIfEmpty("datesInterest", lead.datesInterest, extracted.datesInterest);
    fillIfEmpty("roomTypeInterest", lead.roomTypeInterest, extracted.roomTypeInterest);
    fillIfEmpty("budgetSignal", lead.budgetSignal, extracted.budgetSignal);

    if (
      extracted.status &&
      extracted.status !== lead.status &&
      (STATUS_RANK[extracted.status] ?? -1) > (STATUS_RANK[lead.status] ?? -1)
    ) {
      s.status = { current: lead.status, next: extracted.status };
    }
    if (
      extracted.priority &&
      extracted.priority !== lead.priority &&
      (PRIORITY_RANK[extracted.priority] ?? -1) > (PRIORITY_RANK[lead.priority] ?? -1)
    ) {
      s.priority = { current: lead.priority, next: extracted.priority };
    }
    if (extracted.language && extracted.language !== lead.language) {
      s.language = { current: lead.language, next: extracted.language };
    }
    if (extracted.audience && extracted.audience !== lead.audience) {
      s.audience = { current: lead.audience, next: extracted.audience };
    }

    const existingTags = new Set(lead.interestTags ?? []);
    const newTags = (extracted.interestTags ?? []).filter((t) => !existingTags.has(t));
    if (newTags.length > 0) s.newTags = newTags;

    if (
      extracted.suggestedFollowupHours != null &&
      extracted.suggestedFollowupHours > 0 &&
      extracted.status !== "booked" &&
      extracted.status !== "lost"
    ) {
      const due = new Date(Date.now() + extracted.suggestedFollowupHours * 3600_000);
      s.followup = {
        dueAt: due.toISOString(),
        reason: extracted.suggestedFollowupReason ?? null,
        reasoning: extracted.followupReasoning ?? "",
      };
    }

    return { ok: true, interactionId, suggestions: s };
  } catch (e) {
    return {
      ok: false,
      interactionId,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const applySchema = z.object({
  leadId: z.string().uuid(),
  fields: z
    .object({
      whatSpokeToThem: z.string().nullish(),
      objections: z.string().nullish(),
      numAdults: z.number().int().nullish(),
      numChildren: z.number().int().nullish(),
      agesChildren: z.string().nullish(),
      datesInterest: z.string().nullish(),
      roomTypeInterest: z.string().nullish(),
      budgetSignal: z.enum(["low", "mid", "high"]).nullish(),
      status: z
        .enum(["new", "contacted", "interested", "quoted", "closing", "booked", "lost"])
        .nullish(),
      priority: z.enum(["hot", "warm", "cold"]).nullish(),
      language: z.enum(["he", "en", "yi"]).nullish(),
      audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]).nullish(),
      addTags: z.array(z.string()).default([]),
    })
    .default({ addTags: [] }),
  followup: z
    .object({ dueAt: z.string(), reason: z.string().nullish() })
    .optional(),
});

export async function applyCaptureUpdates(input: {
  leadId: string;
  fields: {
    whatSpokeToThem?: string | null;
    objections?: string | null;
    numAdults?: number | null;
    numChildren?: number | null;
    agesChildren?: string | null;
    datesInterest?: string | null;
    roomTypeInterest?: string | null;
    budgetSignal?: "low" | "mid" | "high" | null;
    status?: "new" | "contacted" | "interested" | "quoted" | "closing" | "booked" | "lost" | null;
    priority?: "hot" | "warm" | "cold" | null;
    language?: "he" | "en" | "yi" | null;
    audience?: "israeli_haredi" | "american_haredi" | "european_haredi" | null;
    addTags?: string[];
  };
  followup?: { dueAt: string; reason?: string | null };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const parsed = applySchema.parse(input);
    const [existing] = await db
      .select({ interestTags: leads.interestTags })
      .from(leads)
      .where(eq(leads.id, parsed.leadId));
    if (!existing) return { ok: false, error: "ליד לא נמצא" };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const f = parsed.fields;
    if (f.whatSpokeToThem) update.whatSpokeToThem = f.whatSpokeToThem;
    if (f.objections) update.objections = f.objections;
    if (f.numAdults != null) update.numAdults = f.numAdults;
    if (f.numChildren != null) update.numChildren = f.numChildren;
    if (f.agesChildren) update.agesChildren = f.agesChildren;
    if (f.datesInterest) update.datesInterest = f.datesInterest;
    if (f.roomTypeInterest) update.roomTypeInterest = f.roomTypeInterest;
    if (f.budgetSignal) update.budgetSignal = f.budgetSignal;
    if (f.status) update.status = f.status;
    if (f.priority) update.priority = f.priority;
    if (f.language) update.language = f.language;
    if (f.audience) update.audience = f.audience;

    if (f.addTags && f.addTags.length > 0) {
      const merged = Array.from(new Set([...(existing.interestTags ?? []), ...f.addTags]));
      update.interestTags = merged;
    }

    await db.update(leads).set(update).where(eq(leads.id, parsed.leadId));

    if (parsed.followup) {
      const due = new Date(parsed.followup.dueAt);
      if (!isNaN(due.getTime())) {
        await supersedeOpenFollowups(parsed.leadId);
        await db.insert(followups).values({
          leadId: parsed.leadId,
          dueAt: due,
          reason: parsed.followup.reason ?? null,
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

    revalidatePath(`/leads/${parsed.leadId}`);
    revalidatePath("/leads");
    revalidatePath("/followups");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
});

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

  revalidatePath("/leads");
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

  await db.insert(interactions).values({
    leadId: parsed.leadId,
    type: "whatsapp",
    direction: "internal",
    content: parsed.chatTranscript,
    aiSummary: parsed.whatSpokeToThem ?? null,
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
        .set({ nextFollowupAt: due, followupCompletedAt: null, updatedAt: new Date() })
        .where(eq(leads.id, parsed.leadId));
    }
  }

  revalidatePath("/leads");
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
  revalidatePath("/");
}
