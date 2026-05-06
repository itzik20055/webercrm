import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  archiveImports,
  conversationArchive,
  type Lead,
  type NewConversationArchive,
} from "@/db";
import {
  countCallRecordingsInRange,
  fetchCallRecordingsInRange,
  type CallRecordingMail,
} from "./gmail-imap";
import { parseCallSubject } from "./call-recording";
import { transcribeAudio } from "./ai-client";
import { extractArchivedConversation } from "./archive-extractor";

/**
 * Phone-archive ingestion. Groups recordings by the customer phone (extracted
 * from email subject `[from=>to]`), builds a chronological trajectory for
 * each customer, transcribes every recording, and runs the same hybrid
 * archetype extractor used by the WhatsApp path. Outcome is *inferred* from
 * the trajectory (last call's tone) rather than user-supplied — we have no
 * pre-existing label for archived call recordings.
 *
 * Bounded by the 270s function ceiling. If the batch can't finish in one
 * invocation, partial rows land in conversation_archive and the next call
 * (`runArchivePhoneBatch` again with the same batchId) skips groups already
 * persisted via the (importBatchId, phoneHash) natural dedup.
 */
const TIME_BUDGET_MS = 270_000;

export interface PhonePreviewResult {
  total: number;
  mailbox: string;
}

export async function previewPhoneArchive(args: {
  dateFrom: Date;
  dateTo: Date;
}): Promise<PhonePreviewResult> {
  const r = await countCallRecordingsInRange(args.dateFrom, args.dateTo);
  return { total: r.total, mailbox: r.mailbox };
}

export interface RunPhoneBatchResult {
  ok: boolean;
  batchId: string;
  status: "processing" | "done" | "failed";
  processedCount: number;
  successCount: number;
  failureCount: number;
  hitTimeBudget: boolean;
  error?: string;
}

interface CustomerGroup {
  phoneHash: string;
  customerPhone: string;
  mails: CallRecordingMail[];
}

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

/**
 * Determines who the customer-side phone number is for a recording. Each
 * FreeTelecom subject carries `[from=>to]`; one of those is איציק, the other
 * is the lead. We pick whichever is NOT in the office's known direct numbers.
 * Falls back to the inbound number if we can't tell.
 */
function customerPhoneOf(subject: string): string | null {
  const meta = parseCallSubject(subject);
  if (!meta) return null;
  // A simple heuristic: shorter numbers (length < 10) are typically internal/
  // office direct lines; the customer is the longer one. Without an explicit
  // office-number list this is the best we can do generically.
  const fromLen = meta.fromPhone.replace(/\D/g, "").length;
  const toLen = meta.toPhone.replace(/\D/g, "").length;
  if (fromLen >= 10 && toLen < 10) return meta.fromPhone;
  if (toLen >= 10 && fromLen < 10) return meta.toPhone;
  // If both look like real numbers, prefer the inbound side (the one that's
  // not the office). We can't tell programmatically so default to the from
  // side, matching how the existing pending_call_recordings flow treats it.
  return meta.fromPhone;
}

function inferAudienceFromPhone(phone: string): Lead["audience"] {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972") || digits.startsWith("0")) return "israeli_haredi";
  if (digits.startsWith("1")) return "american_haredi";
  if (digits.startsWith("44") || digits.startsWith("32") || digits.startsWith("33"))
    return "european_haredi";
  return "israeli_haredi";
}

/**
 * Renders multiple call transcripts as a single trajectory the LLM can read.
 * Uses relative day numbers (matching the WhatsApp archive renderer) so
 * cadence signal survives the scrubber. Each recording is wrapped in a
 * `=== שיחה N — יום D ===` header.
 */
function renderTrajectory(mails: CallRecordingMail[], transcripts: string[]): string {
  if (mails.length === 0) return "";
  const sortedIdx = mails
    .map((_, i) => i)
    .sort((a, b) => mails[a].date.getTime() - mails[b].date.getTime());
  const startMs = mails[sortedIdx[0]].date.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const sections: string[] = [];
  let prevTs: Date | null = null;
  for (let n = 0; n < sortedIdx.length; n++) {
    const i = sortedIdx[n];
    const m = mails[i];
    const t = transcripts[i] || "(תמלול נכשל)";
    const dayN = Math.floor((m.date.getTime() - startMs) / oneDayMs) + 1;

    if (prevTs) {
      const gap = m.date.getTime() - prevTs.getTime();
      if (gap >= 12 * 60 * 60 * 1000) {
        const gapDays = Math.round(gap / oneDayMs);
        sections.push(
          gapDays === 0
            ? "-- אחרי שתיקה של חצי יום --"
            : gapDays === 1
              ? "-- אחרי יום שתיקה --"
              : `-- אחרי ${gapDays} ימי שתיקה --`
        );
      }
    }

    sections.push(`=== שיחה ${n + 1} — יום ${dayN} ===\n${t}`);
    prevTs = m.date;
  }
  return sections.join("\n\n");
}

async function processCustomerGroup(
  group: CustomerGroup,
  batchId: string,
  language: Lead["language"]
): Promise<{ ok: boolean; archiveId?: string; error?: string }> {
  // Transcribe every recording. Done sequentially — Gemini Pro audio is the
  // expensive call (5-30s each) and parallelizing would race against the
  // function timeout for batches with many recordings per phone.
  const transcripts: string[] = [];
  for (const m of group.mails) {
    const audio = m.attachments[0];
    if (!audio) {
      transcripts.push("(אין קובץ אודיו במייל)");
      continue;
    }
    try {
      const t = await transcribeAudio(audio.data, audio.mimeType, {
        language,
        context: "phone_call",
      });
      transcripts.push(t.transcript);
    } catch (e) {
      console.error("[archive-phone] transcribe failed", m.uid, e);
      transcripts.push("(תמלול נכשל)");
    }
  }

  const trajectory = renderTrajectory(group.mails, transcripts);
  const audience = inferAudienceFromPhone(group.customerPhone);

  let extracted;
  try {
    extracted = await extractArchivedConversation({
      rawTranscript: trajectory,
      audience,
      language,
      knownNames: [],
      // No knownOutcome — let the extractor infer from the trajectory.
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const sortedMails = [...group.mails].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  const insertValues: NewConversationArchive = {
    source: "phone_archive",
    phoneHash: group.phoneHash,
    transcript: extracted.scrubbedTranscript,
    audience,
    language,
    archetype: extracted.archetype as object,
    outcome: extracted.outcome,
    outcomeConfidence: extracted.outcomeConfidence,
    embedding: extracted.embedding ?? undefined,
    embeddedAt: extracted.embedding ? new Date() : undefined,
    conversationStartedAt: sortedMails[0].date,
    conversationEndedAt: sortedMails[sortedMails.length - 1].date,
    interactionCount: sortedMails.length,
    importBatchId: batchId,
  };

  const [created] = await db
    .insert(conversationArchive)
    .values(insertValues)
    .returning({ id: conversationArchive.id });

  return { ok: true, archiveId: created.id };
}

export async function runArchivePhoneBatch(
  batchId: string
): Promise<RunPhoneBatchResult> {
  const started = Date.now();

  const [batch] = await db
    .select()
    .from(archiveImports)
    .where(eq(archiveImports.id, batchId));
  if (!batch) {
    return {
      ok: false,
      batchId,
      status: "failed",
      processedCount: 0,
      successCount: 0,
      failureCount: 0,
      hitTimeBudget: false,
      error: "batch not found",
    };
  }
  if (!batch.dateFrom || !batch.dateTo) {
    return {
      ok: false,
      batchId,
      status: "failed",
      processedCount: 0,
      successCount: 0,
      failureCount: 0,
      hitTimeBudget: false,
      error: "batch missing date range",
    };
  }

  const language: Lead["language"] = "he";

  if (batch.status !== "processing") {
    await db
      .update(archiveImports)
      .set({ status: "processing", startedAt: batch.startedAt ?? new Date() })
      .where(eq(archiveImports.id, batchId));
  }

  // Phone hashes already saved for this batch — natural dedup across resumed
  // invocations. Allows the worker to be safely re-run after timeout.
  const alreadyDone = await db
    .select({ phoneHash: conversationArchive.phoneHash })
    .from(conversationArchive)
    .where(eq(conversationArchive.importBatchId, batchId));
  const donePhoneHashes = new Set(
    alreadyDone.map((r) => r.phoneHash).filter((h): h is string => !!h)
  );

  let successCount = batch.successCount;
  let failureCount = batch.failureCount;
  let processedCount = batch.processedCount;
  let hitTimeBudget = false;

  // Pull mails in waves. After each wave we group by phone, process any group
  // whose phoneHash isn't already saved, then fetch the next wave. We track
  // exhausted UIDs to avoid re-fetching the same envelopes.
  const consumedUids: number[] = [];

  while (Date.now() - started < TIME_BUDGET_MS) {
    const wave = await fetchCallRecordingsInRange({
      from: batch.dateFrom,
      to: batch.dateTo,
      excludeUids: consumedUids,
      limit: 10,
    });
    if (wave.length === 0) break;

    // Bucket the wave by phone hash. Each group contains all messages from
    // this wave belonging to the same customer.
    const groups = new Map<string, CustomerGroup>();
    for (const m of wave) {
      consumedUids.push(m.uid);
      const customerPhone = customerPhoneOf(m.subject);
      if (!customerPhone) continue;
      const phoneHash = hashPhone(customerPhone);
      if (donePhoneHashes.has(phoneHash)) continue;
      const existing = groups.get(phoneHash);
      if (existing) {
        existing.mails.push(m);
      } else {
        groups.set(phoneHash, { phoneHash, customerPhone, mails: [m] });
      }
    }

    for (const group of groups.values()) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        hitTimeBudget = true;
        break;
      }
      const result = await processCustomerGroup(group, batchId, language);
      processedCount += 1;
      if (result.ok) {
        successCount += 1;
        donePhoneHashes.add(group.phoneHash);
      } else {
        failureCount += 1;
        console.error(
          "[archive-phone] group failed",
          group.phoneHash.slice(0, 8),
          result.error
        );
      }
      await db
        .update(archiveImports)
        .set({ processedCount, successCount, failureCount })
        .where(eq(archiveImports.id, batchId));
    }

    if (hitTimeBudget) break;
  }

  // We've drained when fetchCallRecordingsInRange returned empty. If we
  // didn't drain AND didn't hit the time budget, something else stopped us
  // (rare); leave status as processing for the next call.
  const drained =
    !hitTimeBudget && consumedUids.length > 0 &&
    (await fetchCallRecordingsInRange({
      from: batch.dateFrom,
      to: batch.dateTo,
      excludeUids: consumedUids,
      limit: 1,
    })).length === 0;

  const finalStatus: "processing" | "done" = drained && !hitTimeBudget ? "done" : "processing";

  await db
    .update(archiveImports)
    .set({
      processedCount,
      successCount,
      failureCount,
      status: finalStatus,
      finishedAt: finalStatus === "done" ? new Date() : null,
    })
    .where(eq(archiveImports.id, batchId));

  return {
    ok: true,
    batchId,
    status: finalStatus,
    processedCount,
    successCount,
    failureCount,
    hitTimeBudget,
  };
}
