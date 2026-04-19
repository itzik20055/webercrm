"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, leads, interactions, voiceExamples } from "@/db";
import { draftReply, type DraftScenario } from "@/lib/ai-client";

const SCENARIOS = [
  "first_reply",
  "send_price",
  "price_objection",
  "silent_followup",
  "date_confirmation",
  "closing_request",
  "general",
] as const;

const generateSchema = z.object({
  leadId: z.string().uuid(),
  scenario: z.enum(SCENARIOS),
  freeNote: z.string().max(1000).optional(),
});

export type GenerateDraftResult =
  | {
      ok: true;
      draft: string;
      reasoning: string;
      exampleCount: number;
      contextSnapshot: Record<string, unknown>;
      durationMs: number;
    }
  | { ok: false; error: string };

export async function generateDraft(input: {
  leadId: string;
  scenario: DraftScenario;
  freeNote?: string;
}): Promise<GenerateDraftResult> {
  try {
    const parsed = generateSchema.parse(input);
    const [lead] = await db.select().from(leads).where(eq(leads.id, parsed.leadId));
    if (!lead) return { ok: false, error: "ליד לא נמצא" };

    const recent = await db
      .select()
      .from(interactions)
      .where(eq(interactions.leadId, parsed.leadId))
      .orderBy(desc(interactions.occurredAt))
      .limit(10);

    const result = await draftReply({
      lead,
      recentInteractions: recent,
      scenario: parsed.scenario,
      freeNote: parsed.freeNote,
    });

    return {
      ok: true,
      draft: result.draft,
      reasoning: result.reasoning,
      exampleCount: result.exampleCount,
      contextSnapshot: result.contextSnapshot,
      durationMs: result.durationMs,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

const saveSchema = z.object({
  leadId: z.string().uuid(),
  scenario: z.enum(SCENARIOS),
  aiDraft: z.string().min(1).max(8000),
  finalText: z.string().min(1).max(8000),
  contextSnapshot: z.record(z.string(), z.unknown()).optional(),
});

export async function saveVoiceExample(input: {
  leadId: string;
  scenario: DraftScenario;
  aiDraft: string;
  finalText: string;
  contextSnapshot?: Record<string, unknown>;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const parsed = saveSchema.parse(input);
    const [lead] = await db
      .select({ language: leads.language, audience: leads.audience })
      .from(leads)
      .where(eq(leads.id, parsed.leadId));
    if (!lead) return { ok: false, error: "ליד לא נמצא" };

    const [created] = await db
      .insert(voiceExamples)
      .values({
        leadId: parsed.leadId,
        scenario: parsed.scenario,
        language: lead.language,
        audience: lead.audience,
        aiDraft: parsed.aiDraft,
        finalText: parsed.finalText,
        contextSnapshot: parsed.contextSnapshot ?? null,
      })
      .returning({ id: voiceExamples.id });

    revalidatePath(`/leads/${parsed.leadId}`);
    return { ok: true, id: created.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
