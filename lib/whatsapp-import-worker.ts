import { db, leads, pendingWhatsAppImports } from "@/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { importWhatsAppExport } from "./whatsapp-import";
import { extractLeadFromChat } from "./ai-client";
import { getSetting } from "./settings";
import { phoneTail } from "./phone";

export type ProcessResult =
  | { ok: true; id: string; status: "done" }
  | { ok: true; status: "no_work" }
  | { ok: false; id?: string; status: "failed"; error: string };

/**
 * Atomically claims the oldest pending import (status: pending → processing)
 * and returns it. Uses a RETURNING update so two workers running at the same
 * time never grab the same row — the loser gets no row back.
 *
 * If `onlyId` is set we try to claim that specific row (used by the upload
 * handler right after it inserts the row). Falls back to "null claimed" if
 * another worker got to it first — that's fine, the work still happens.
 */
async function claimPending(
  onlyId?: string
): Promise<typeof pendingWhatsAppImports.$inferSelect | null> {
  const now = new Date();
  if (onlyId) {
    const claimed = await db
      .update(pendingWhatsAppImports)
      .set({ status: "processing", processingStartedAt: now })
      .where(
        and(
          eq(pendingWhatsAppImports.id, onlyId),
          eq(pendingWhatsAppImports.status, "pending")
        )
      )
      .returning();
    return claimed[0] ?? null;
  }

  const oldest = await db
    .select({ id: pendingWhatsAppImports.id })
    .from(pendingWhatsAppImports)
    .where(eq(pendingWhatsAppImports.status, "pending"))
    .orderBy(pendingWhatsAppImports.createdAt)
    .limit(1);
  if (oldest.length === 0) return null;

  const claimed = await db
    .update(pendingWhatsAppImports)
    .set({ status: "processing", processingStartedAt: now })
    .where(
      and(
        eq(pendingWhatsAppImports.id, oldest[0].id),
        eq(pendingWhatsAppImports.status, "pending")
      )
    )
    .returning();
  return claimed[0] ?? null;
}

async function findMatches(leadName: string | null, phones: string[]) {
  const conds = [];
  if (leadName) conds.push(ilike(leads.name, `%${leadName}%`));
  for (const phone of phones) {
    const tail = phoneTail(phone);
    if (tail.length >= 7) {
      conds.push(
        sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9) = ${tail}`
      );
    }
  }
  if (conds.length === 0) return [];
  return db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      status: leads.status,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(or(...conds))
    .orderBy(desc(leads.updatedAt))
    .limit(5);
}

/**
 * Runs the full pipeline for one claimed row: parse ZIP, transcribe audio,
 * AI extraction, match against existing leads, and write the result back.
 *
 * Token safety: processing happens exactly once per row — the row was claimed
 * atomically by `claimPending`, so even if two invocations raced, only one
 * reaches this function. `failed` is terminal; we never auto-retry.
 */
export async function processOne(opts: { id?: string } = {}): Promise<ProcessResult> {
  const row = await claimPending(opts.id);
  if (!row) return { ok: true, status: "no_work" };

  try {
    const myName = await getSetting("whatsapp_display_name");
    if (!myName) {
      throw new Error(
        "לא הוגדר השם שלך בוואטסאפ (בהגדרות) — אי אפשר לזהות מי שלח כל הודעה."
      );
    }

    const imported = await importWhatsAppExport(row.fileBytes, {
      isZip: row.isZip,
      myName,
      language: row.language ?? undefined,
      originalFilename: row.originalFilename,
    });

    if (imported.chat.messages.length === 0) {
      throw new Error(
        "לא זוהו הודעות בקובץ. ייתכן שהפורמט לא נתמך."
      );
    }

    const { lead: extraction } = await extractLeadFromChat({
      chatText: imported.renderedChat,
      leadName: imported.inferredLeadName,
      ourName: myName,
    });

    const matches = await findMatches(
      imported.inferredLeadName,
      imported.inferredPhones
    );

    await db
      .update(pendingWhatsAppImports)
      .set({
        status: "done",
        processedAt: new Date(),
        inferredLeadName: imported.inferredLeadName ?? null,
        inferredPhones: imported.inferredPhones,
        renderedChat: imported.renderedChat,
        extraction: extraction as object,
        audioStats: imported.audioStats,
        messageCount: imported.chat.messages.length,
        firstMessageAt: imported.chat.messages[0]?.timestamp ?? null,
        lastMessageAt: imported.chat.messages.at(-1)?.timestamp ?? null,
        matchCandidateIds: matches.map((m) => m.id),
        // Clear the raw bytes — we have what we need. Saves a lot of DB space.
        fileBytes: Buffer.alloc(0),
        error: null,
      })
      .where(eq(pendingWhatsAppImports.id, row.id));

    return { ok: true, id: row.id, status: "done" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[whatsapp-import-worker] failed", row.id, e);
    await db
      .update(pendingWhatsAppImports)
      .set({
        status: "failed",
        processedAt: new Date(),
        error: message,
      })
      .where(eq(pendingWhatsAppImports.id, row.id));
    return { ok: false, id: row.id, status: "failed", error: message };
  }
}
