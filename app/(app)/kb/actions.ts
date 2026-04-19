"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, productKb } from "@/db";

const KB_CATEGORIES = [
  "hotel",
  "rooms",
  "food",
  "activities",
  "prices",
  "logistics",
  "faq",
] as const;

const createSchema = z.object({
  category: z.enum(KB_CATEGORIES),
  language: z.enum(["he", "en", "yi"]).default("he"),
  title: z.string().min(1, "כותרת חובה").max(160),
  content: z.string().min(1, "תוכן חובה").max(8000),
  active: z.coerce.boolean().default(true),
});

export async function createKbEntry(formData: FormData) {
  const parsed = createSchema.parse({
    category: formData.get("category"),
    language: formData.get("language") || "he",
    title: String(formData.get("title") ?? "").trim(),
    content: String(formData.get("content") ?? "").trim(),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });

  await db.insert(productKb).values({
    category: parsed.category,
    language: parsed.language,
    title: parsed.title,
    content: parsed.content,
    active: parsed.active,
  });

  revalidatePath("/kb");
  redirect("/kb");
}

const updateSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(KB_CATEGORIES),
  language: z.enum(["he", "en", "yi"]),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(8000),
  active: z.coerce.boolean().default(true),
});

export async function updateKbEntry(formData: FormData) {
  const parsed = updateSchema.parse({
    id: formData.get("id"),
    category: formData.get("category"),
    language: formData.get("language") || "he",
    title: String(formData.get("title") ?? "").trim(),
    content: String(formData.get("content") ?? "").trim(),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });

  await db
    .update(productKb)
    .set({
      category: parsed.category,
      language: parsed.language,
      title: parsed.title,
      content: parsed.content,
      active: parsed.active,
      updatedAt: new Date(),
    })
    .where(eq(productKb.id, parsed.id));

  revalidatePath("/kb");
  revalidatePath(`/kb/${parsed.id}/edit`);
  redirect("/kb");
}

export async function toggleKbActive(id: string, next: boolean) {
  await db
    .update(productKb)
    .set({ active: next, updatedAt: new Date() })
    .where(eq(productKb.id, id));
  revalidatePath("/kb");
}

export async function deleteKbEntry(id: string) {
  await db.delete(productKb).where(eq(productKb.id, id));
  revalidatePath("/kb");
  redirect("/kb");
}
