import { createHash } from "node:crypto";
import { db, conversationArchive, type Lead, type NewConversationArchive } from "@/db";
import { extractArchivedConversation } from "./archive-extractor";
import { importWhatsAppExport } from "./whatsapp-import";
import { renderChatForArchive } from "./whatsapp-parser";
import { getSetting } from "./settings";

/**
 * Single-shot WhatsApp archive ingestion. Runs the existing WhatsApp parser
 * for transcript + media transcription, then hands the result to the archive
 * extractor (hybrid persona/objection/winning-angle schema), then inserts a
 * `conversation_archive` row. Never touches `leads` or `pending_*` tables —
 * archive entries are visible only to the draft-time retrieval channel.
 */
export interface IngestArchiveResult {
  ok: boolean;
  archiveId?: string;
  conversationCount?: number;
  scrubStats?: { removedPrices: number; removedDates: number; removedTimes: number };
  outcome?: "booked" | "lost" | "unknown";
  outcomeConfidence?: number;
  error?: string;
}

export interface IngestArchiveArgs {
  fileBytes: Buffer;
  isZip: boolean;
  originalFilename: string;
  audience: Lead["audience"];
  language: Lead["language"];
  /**
   * Caller-supplied outcome label. Set to "booked" when the user is uploading
   * a curated export of "deals I closed" — saves an LLM call and avoids the
   * extractor second-guessing a known label.
   */
  knownOutcome?: "booked" | "lost";
  importBatchId?: string;
}

export async function ingestWhatsAppArchive(
  args: IngestArchiveArgs
): Promise<IngestArchiveResult> {
  const myName = await getSetting("whatsapp_display_name");
  if (!myName) {
    return {
      ok: false,
      error: "קודם הגדר את שם הוואטסאפ שלך בהגדרות — בלי זה לא נדע מי שלח כל הודעה.",
    };
  }

  let parsed;
  try {
    parsed = await importWhatsAppExport(args.fileBytes, {
      isZip: args.isZip,
      myName,
      language: args.language,
      originalFilename: args.originalFilename,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "פירוק הקובץ נכשל",
    };
  }

  if (parsed.chat.messages.length === 0) {
    return {
      ok: false,
      error: "לא זוהו הודעות בקובץ — ייתכן שהפורמט לא נתמך.",
    };
  }

  const knownNames = parsed.inferredLeadName ? [parsed.inferredLeadName] : [];

  // Re-render the chat with relative day numbers and explicit silence
  // annotations so the LLM sees cadence signal even after the scrubber
  // strips time-of-day. parsed.renderedChat (used by the leads pipeline) has
  // absolute ISO timestamps, which would just get scrubbed away here.
  const transcriptForExtraction = renderChatForArchive(parsed.chat, {
    myName,
    transcripts: parsed.transcripts,
  });

  let extracted;
  try {
    extracted = await extractArchivedConversation({
      rawTranscript: transcriptForExtraction,
      audience: args.audience,
      language: args.language,
      knownNames,
      knownOutcome: args.knownOutcome,
    });
  } catch (e) {
    return {
      ok: false,
      error:
        "חילוץ ה-LLM נכשל — " + (e instanceof Error ? e.message : String(e)),
    };
  }

  const phoneHash =
    parsed.inferredPhones[0]
      ? createHash("sha256").update(parsed.inferredPhones[0]).digest("hex")
      : null;

  const firstMessageAt = parsed.chat.messages[0]?.timestamp ?? null;
  const lastMessageAt = parsed.chat.messages.at(-1)?.timestamp ?? null;

  const insertValues: NewConversationArchive = {
    source: "whatsapp_archive",
    phoneHash,
    transcript: extracted.scrubbedTranscript,
    audience: args.audience,
    language: args.language,
    archetype: extracted.archetype as object,
    outcome: extracted.outcome,
    outcomeConfidence: extracted.outcomeConfidence,
    embedding: extracted.embedding ?? undefined,
    embeddedAt: extracted.embedding ? new Date() : undefined,
    conversationStartedAt: firstMessageAt,
    conversationEndedAt: lastMessageAt,
    interactionCount: parsed.chat.messages.length,
    importBatchId: args.importBatchId ?? null,
  };

  const [created] = await db
    .insert(conversationArchive)
    .values(insertValues)
    .returning({ id: conversationArchive.id });

  return {
    ok: true,
    archiveId: created.id,
    conversationCount: parsed.chat.messages.length,
    scrubStats: extracted.scrubStats,
    outcome: extracted.outcome,
    outcomeConfidence: extracted.outcomeConfidence,
  };
}
