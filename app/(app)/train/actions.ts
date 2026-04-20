"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, productKb } from "@/db";
import { answerCustomerQuestion } from "@/lib/ai-client";

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  audience: z.enum(["israeli_haredi", "american_haredi", "european_haredi"]),
  language: z.enum(["he", "en", "yi"]),
});

export type AskResult =
  | { ok: true; answer: string; durationMs: number }
  | { ok: false; error: string };

export async function askQuestion(input: {
  question: string;
  audience: "israeli_haredi" | "american_haredi" | "european_haredi";
  language: "he" | "en" | "yi";
}): Promise<AskResult> {
  try {
    const parsed = askSchema.parse(input);
    const res = await answerCustomerQuestion(parsed);
    return { ok: true, answer: res.answer, durationMs: res.durationMs };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const saveSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(8000),
  language: z.enum(["he", "en", "yi"]),
});

export async function saveAsFaq(input: {
  question: string;
  answer: string;
  language: "he" | "en" | "yi";
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const parsed = saveSchema.parse(input);
    const title = parsed.question.replace(/\s+/g, " ").trim().slice(0, 120);
    const content = `ש: ${parsed.question.trim()}\n\nת: ${parsed.answer.trim()}`;

    const [created] = await db
      .insert(productKb)
      .values({
        category: "faq",
        language: parsed.language,
        title,
        content,
        active: true,
      })
      .returning({ id: productKb.id });

    revalidatePath("/kb");
    revalidatePath("/train");
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
