import { NextResponse } from "next/server";
import { z } from "zod";
import { streamText, createTextStreamResponse } from "ai";
import { db, aiAuditLog } from "@/db";
import { buildChatPrompts, type ChatMessage } from "@/lib/chat";
import { createDeanonymizeStream } from "@/lib/ai-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  leadId: z.string().uuid().nullable().optional(),
  audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]).optional(),
  language: z.enum(["he", "en", "yi"]).optional(),
});

export async function POST(req: Request) {
  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 }
    );
  }

  const prompts = await buildChatPrompts({
    messages: body.messages as ChatMessage[],
    leadId: body.leadId ?? null,
    audience: body.audience,
    language: body.language,
  });

  const start = Date.now();
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");

  const result = streamText({
    model: prompts.model,
    messages: [
      { role: "system", content: prompts.systemPrompt },
      ...prompts.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    onFinish: async (event) => {
      await db
        .insert(aiAuditLog)
        .values({
          operation: prompts.leadContext.lead ? "chat:lead" : "chat:general",
          model: prompts.model,
          inputAnonymized: lastUser?.content ?? "",
          output: event.text || null,
          placeholderMap: prompts.leadContext.placeholderMap,
          leadId: prompts.leadContext.lead?.id ?? null,
          durationMs: Date.now() - start,
        })
        .catch(() => {});
    },
    onError: async ({ error }) => {
      await db
        .insert(aiAuditLog)
        .values({
          operation: prompts.leadContext.lead ? "chat:lead" : "chat:general",
          model: prompts.model,
          inputAnonymized: lastUser?.content ?? "",
          output: null,
          placeholderMap: prompts.leadContext.placeholderMap,
          leadId: prompts.leadContext.lead?.id ?? null,
          durationMs: Date.now() - start,
          error: error instanceof Error ? error.message : String(error),
        })
        .catch(() => {});
    },
  });

  // Lead context is anonymized in the system prompt, so model output may
  // contain placeholders ([NAME], [PHONE_1]). Deanonymize for display.
  const textStream = result.textStream.pipeThrough(
    createDeanonymizeStream(prompts.leadContext.placeholderMap)
  );

  return createTextStreamResponse({
    textStream,
    headers: {
      "X-Accel-Buffering": "no",
      "X-Chat-Audience": prompts.resolvedAudience,
      "X-Chat-Language": prompts.resolvedLanguage,
    },
  });
}
