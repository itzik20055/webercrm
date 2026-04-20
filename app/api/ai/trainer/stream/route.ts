import { NextResponse } from "next/server";
import { z } from "zod";
import { streamText, createTextStreamResponse } from "ai";
import {
  buildCustomerQAPrompts,
  logCustomerQA,
  type CustomerQAInput,
} from "@/lib/ai-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]),
  language: z.enum(["he", "en", "yi"]),
});

export async function POST(req: Request) {
  let parsed: CustomerQAInput;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 }
    );
  }

  const prompts = await buildCustomerQAPrompts(parsed);
  const start = Date.now();

  const result = streamText({
    model: prompts.model,
    messages: [
      { role: "system", content: prompts.systemPrompt },
      { role: "user", content: prompts.question },
    ],
    onFinish: async (event) => {
      await logCustomerQA({
        input: parsed,
        model: prompts.model,
        output: event.text,
        durationMs: Date.now() - start,
      });
    },
    onError: async ({ error }) => {
      await logCustomerQA({
        input: parsed,
        model: prompts.model,
        output: "",
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return createTextStreamResponse({
    textStream: result.textStream,
    headers: { "X-Accel-Buffering": "no" },
  });
}
