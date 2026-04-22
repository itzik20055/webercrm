import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { streamText, createTextStreamResponse } from "ai";
import { db, leads, interactions } from "@/db";
import {
  buildDraftPrompts,
  createDeanonymizeStream,
  logDraftReply,
  type DraftScenario,
} from "@/lib/ai-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SCENARIOS = [
  "first_reply",
  "send_price",
  "price_objection",
  "silent_followup",
  "date_confirmation",
  "closing_request",
  "general",
] as const satisfies readonly DraftScenario[];

const bodySchema = z.object({
  leadId: z.string().uuid(),
  scenario: z.enum(SCENARIOS),
  freeNote: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 }
    );
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, parsed.leadId));
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });

  const recent = await db
    .select()
    .from(interactions)
    .where(eq(interactions.leadId, parsed.leadId))
    .orderBy(desc(interactions.occurredAt), desc(interactions.id))
    .limit(10);

  const prompts = await buildDraftPrompts({
    lead,
    recentInteractions: recent,
    scenario: parsed.scenario,
    freeNote: parsed.freeNote,
  });

  const start = Date.now();

  const result = streamText({
    model: prompts.model,
    messages: [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.userPrompt },
    ],
    abortSignal: req.signal,
    onFinish: async (event) => {
      await logDraftReply({
        scenario: parsed.scenario,
        leadId: lead.id,
        model: prompts.model,
        inputAnonymized: prompts.inputAnonymized,
        outputAnonymized: event.text,
        placeholderMap: prompts.placeholderMap,
        durationMs: Date.now() - start,
      });
    },
    onError: async ({ error }) => {
      await logDraftReply({
        scenario: parsed.scenario,
        leadId: lead.id,
        model: prompts.model,
        inputAnonymized: prompts.inputAnonymized,
        outputAnonymized: "",
        placeholderMap: prompts.placeholderMap,
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const textStream = result.textStream.pipeThrough(
    createDeanonymizeStream(prompts.placeholderMap)
  );

  return createTextStreamResponse({
    textStream,
    headers: {
      "X-Accel-Buffering": "no",
      "X-Draft-Context": Buffer.from(
        JSON.stringify({
          contextSnapshot: prompts.contextSnapshot,
          exampleCount: prompts.exampleCount,
        })
      ).toString("base64"),
    },
  });
}
