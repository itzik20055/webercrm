"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, voiceExamples } from "@/db";

export async function deleteVoiceExample(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "invalid id" };
  await db.delete(voiceExamples).where(eq(voiceExamples.id, parsed.data));
  revalidatePath("/kb/learning");
  return { ok: true };
}
