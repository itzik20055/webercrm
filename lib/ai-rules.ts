"use server";

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db, appSettings } from "@/db";
import { invalidateAiRulesCache } from "@/lib/ai-client";

const AI_RULES_KEY = "ai_writing_rules";
const rulesSchema = z.string().max(8000);

export async function getAiRules(): Promise<string> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, AI_RULES_KEY));
  return row?.value ?? "";
}

export async function saveAiRules(
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const value = rulesSchema.parse(text);
    await db
      .insert(appSettings)
      .values({ key: AI_RULES_KEY, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: sql`now()` },
      });
    invalidateAiRulesCache();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
