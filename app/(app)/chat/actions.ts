"use server";

import { z } from "zod";
import { desc, eq, ilike, or } from "drizzle-orm";
import { db, leads, voiceExamples, interactions, type Lead } from "@/db";
import { embedOne } from "@/lib/embeddings";
import { anonymize } from "@/lib/anonymize";

/**
 * Manual save score — slightly above the "manual" default (0.5). The cron
 * uses the full [-1, +1] range; manual confirmations live in a tighter
 * positive band so they don't overpower outcome-mined signal.
 */
const MANUAL_CONFIRM_SCORE = 0.7;

const SearchSchema = z.object({
  q: z.string().min(1).max(40),
  limit: z.number().int().min(1).max(20).optional(),
});

export type LeadSearchHit = {
  id: string;
  name: string;
  phone: string;
  status: Lead["status"];
  audience: Lead["audience"];
  language: Lead["language"];
};

export async function searchLeadsForChat(
  input: z.input<typeof SearchSchema>
): Promise<LeadSearchHit[]> {
  const parsed = SearchSchema.safeParse(input);
  if (!parsed.success) return [];
  const term = `%${parsed.data.q.trim()}%`;
  const limit = parsed.data.limit ?? 8;
  return db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      status: leads.status,
      audience: leads.audience,
      language: leads.language,
    })
    .from(leads)
    .where(or(ilike(leads.name, term), ilike(leads.phone, term)))
    .orderBy(desc(leads.updatedAt))
    .limit(limit);
}

export async function getLeadForChat(leadId: string): Promise<LeadSearchHit | null> {
  const id = z.string().uuid().safeParse(leadId);
  if (!id.success) return null;
  const [row] = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      status: leads.status,
      audience: leads.audience,
      language: leads.language,
    })
    .from(leads)
    .where(eq(leads.id, id.data));
  return row ?? null;
}

const SaveSchema = z.object({
  leadId: z.string().uuid().nullable().optional(),
  audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]),
  language: z.enum(["he", "en", "yi"]),
  scenario: z
    .enum([
      "first_reply",
      "send_price",
      "price_objection",
      "silent_followup",
      "date_confirmation",
      "closing_request",
      "general",
    ])
    .optional(),
  aiDraft: z.string().min(1).max(8000),
  finalText: z.string().min(1).max(8000),
  question: z.string().max(8000).optional(),
});

export async function saveChatAsVoiceExample(
  input: z.input<typeof SaveSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const parsed = SaveSchema.parse(input);

    let knownNames: string[] = [];
    if (parsed.leadId) {
      const [lead] = await db
        .select({ name: leads.name })
        .from(leads)
        .where(eq(leads.id, parsed.leadId));
      if (lead?.name) knownNames = [lead.name];
    }

    const { anonymized: anonDraft } = anonymize(parsed.aiDraft, knownNames);
    const { anonymized: anonFinal } = anonymize(parsed.finalText, knownNames);

    let embedding: number[] | null = null;
    try {
      embedding = await embedOne(anonFinal);
    } catch {
      embedding = null;
    }

    const [created] = await db
      .insert(voiceExamples)
      .values({
        leadId: parsed.leadId ?? null,
        scenario: parsed.scenario ?? "general",
        language: parsed.language,
        audience: parsed.audience,
        aiDraft: anonDraft,
        finalText: anonFinal,
        contextSnapshot: parsed.question
          ? { question: parsed.question.slice(0, 1000) }
          : null,
        embedding: embedding ?? undefined,
        embeddedAt: embedding ? new Date() : undefined,
        source: "manual",
        score: MANUAL_CONFIRM_SCORE,
      })
      .returning({ id: voiceExamples.id });

    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const LogPasteSchema = z.object({
  leadId: z.string().uuid(),
  content: z.string().min(1).max(20000),
  type: z.enum(["whatsapp", "note", "email", "sms"]).optional(),
});

export async function logPasteToLead(
  input: z.input<typeof LogPasteSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const parsed = LogPasteSchema.parse(input);
    await db.insert(interactions).values({
      leadId: parsed.leadId,
      type: parsed.type ?? "whatsapp",
      direction: "in",
      content: parsed.content,
      occurredAt: new Date(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
