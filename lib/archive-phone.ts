import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  archiveImports,
  conversationArchive,
  type Lead,
  type NewConversationArchive,
} from "@/db";
import {
  fetchCallRecordingsInRange,
  type CallRecordingMail,
} from "./gmail-imap";
import { parseCallSubject } from "./call-recording";
import { transcribeAudio } from "./ai-client";
import { extractArchivedConversation } from "./archive-extractor";
import { safeErrorMessage } from "./sanitize";

/**
 * Phone-archive ingestion. Groups recordings by the customer phone (extracted
 * from email subject `[from=>to]`), builds a chronological trajectory for
 * each customer, transcribes every recording, and runs the same hybrid
 * archetype extractor used by the WhatsApp path. Outcome is *inferred* from
 * the trajectory (last call's tone) rather than user-supplied — we have no
 * pre-existing label for archived call recordings.
 *
 * The worker is intended to be called once per batch via after() in the
 * /start endpoint. It is idempotent: a unique index on
 * (importBatchId, phoneHash) plus an onConflictDoNothing insert ensures
 * concurrent or re-triggered runs cannot create duplicate rows for the same
 * customer.
 *
 * For batches that don't fit in a single 300s function: when the worker
 * detects it's about to hit TIME_BUDGET_MS with groups still queued, it
 * fires an HTTP request to /api/archive/phone/resume which spawns a fresh
 * function invocation that picks up where this one stopped. The resume
 * count is capped at MAX_RESUMES so a stuck group can't loop forever.
 */
/**
 * Vercel kills the function at 300s. The watchdog fires at WATCHDOG_MS to
 * trigger self-resume *before* the kill, even if the worker is mid-await
 * inside processCustomerGroup (which can run 3+ minutes for customers with
 * many recordings).
 */
const WATCHDOG_MS = 270_000;

/**
 * Used by the in-loop pre-group check. Conservative — if we haven't started
 * a new group by here, we'd rather defer to the next invocation. The smart
 * cost estimate below is what actually decides whether to enter a group.
 */
const SOFT_BUDGET_MS = 230_000;

/**
 * Per-recording cost guess. Each FreeTelecom recording is one Gemini Pro
 * audio call which empirically averages 30s, occasionally up to 90s. Plus
 * one NER + one extract call (~5s each) per group. Used by
 * `estimateGroupMs` to decide whether a group will fit in the remaining
 * budget — a 5-recording customer needs ~3 minutes of headroom.
 */
const PER_RECORDING_MS = 35_000;
const PER_GROUP_OVERHEAD_MS = 15_000;

const MAX_RESUMES = 50;

/**
 * Fires an HTTP request to /api/archive/phone/resume to spin up a fresh
 * Vercel function for the same batch. Auth is via CRON_SECRET. Fire-and-
 * forget — we don't block on the response body, only on the connection
 * being established (so a network failure surfaces as a logged error).
 */
async function selfResume(batchId: string): Promise<void> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.APP_URL ?? "http://localhost:3000";
  if (!process.env.CRON_SECRET) {
    console.error(
      "[archive-phone] cannot self-resume — CRON_SECRET not set",
      batchId
    );
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/api/archive/phone/resume`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({ batchId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(
        "[archive-phone] self-resume returned non-OK",
        batchId,
        res.status,
        text.slice(0, 200)
      );
    }
  } catch (e) {
    console.error(
      "[archive-phone] self-resume fetch failed",
      batchId,
      safeErrorMessage(e)
    );
  }
}

export interface PhonePreviewResult {
  total: number;
  mailbox: string;
}

interface CustomerGroup {
  phoneHash: string;
  customerPhone: string;
  mails: CallRecordingMail[];
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

function hashPhone(phone: string): string {
  return createHash("sha256").update(phone).digest("hex");
}

function estimateGroupMs(group: CustomerGroup): number {
  return PER_RECORDING_MS * group.mails.length + PER_GROUP_OVERHEAD_MS;
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

export async function previewPhoneArchive(args: {
  dateFrom: Date;
  dateTo: Date;
}): Promise<PhonePreviewResult> {
  const { countCallRecordingsInRange } = await import("./gmail-imap");
  const r = await countCallRecordingsInRange(args.dateFrom, args.dateTo);
  return { total: r.total, mailbox: r.mailbox };
}

async function processCustomerGroup(
  group: CustomerGroup,
  batchId: string,
  language: Lead["language"]
): Promise<{ ok: boolean; archiveId?: string; skipped?: boolean; error?: string }> {
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
      console.error(
        "[archive-phone] transcribe failed",
        m.uid,
        safeErrorMessage(e)
      );
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
    });
  } catch (e) {
    return {
      ok: false,
      error: safeErrorMessage(e),
    };
  }

  const sortedMails = [...group.mails].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  const insertValues: NewConversationArchive = {
    source: "phone_archive",
    phoneHash: group.phoneHash,
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

  // The unique index `conversation_archive_batch_phone_uq` on
  // (importBatchId, phoneHash) is the safety net against any race that slips
  // past the donePhoneHashes filter. The index is partial (WHERE both columns
  // are not null), so the ON CONFLICT spec must echo that WHERE clause for
  // Postgres to match it — otherwise we get "no unique or exclusion
  // constraint matching the ON CONFLICT specification". Returning [] means
  // the row already existed — treat as a benign no-op.
  const inserted = await db
    .insert(conversationArchive)
    .values(insertValues)
    .onConflictDoNothing({
      target: [conversationArchive.importBatchId, conversationArchive.phoneHash],
      // `where` on onConflictDoNothing maps to the index-WHERE match clause,
      // which is what Postgres needs to recognize a partial unique index.
      where: sql`${conversationArchive.importBatchId} is not null and ${conversationArchive.phoneHash} is not null`,
    })
    .returning({ id: conversationArchive.id });

  if (inserted.length === 0) {
    return { ok: true, skipped: true };
  }
  return { ok: true, archiveId: inserted[0].id };
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
  if (batch.status === "done") {
    return {
      ok: true,
      batchId,
      status: "done",
      processedCount: batch.processedCount,
      successCount: batch.successCount,
      failureCount: batch.failureCount,
      hitTimeBudget: false,
    };
  }

  const language: Lead["language"] = "he";

  await db
    .update(archiveImports)
    .set({ status: "processing", startedAt: batch.startedAt ?? new Date() })
    .where(eq(archiveImports.id, batchId));

  let successCount = batch.successCount;
  let failureCount = batch.failureCount;
  let processedCount = batch.processedCount;
  let hitTimeBudget = false;

  // Watchdog: regardless of where the worker is in its async chain, fire
  // self-resume 30s before Vercel kills the function. Without this, a worker
  // stuck inside a long Gemini transcription would die without ever reaching
  // the end-of-loop self-chain code.
  let watchdogFired = false;
  const watchdog = setTimeout(async () => {
    watchdogFired = true;
    console.warn(
      `[archive-phone] watchdog firing for batch ${batchId} — about to time out`
    );
    if ((batch.resumeCount ?? 0) >= MAX_RESUMES) {
      await db
        .update(archiveImports)
        .set({
          status: "failed",
          error: `Reached max self-resume count (${MAX_RESUMES}).`,
          finishedAt: new Date(),
        })
        .where(eq(archiveImports.id, batchId));
      return;
    }
    await db
      .update(archiveImports)
      .set({ resumeCount: (batch.resumeCount ?? 0) + 1 })
      .where(eq(archiveImports.id, batchId));
    await selfResume(batchId);
  }, WATCHDOG_MS);

  try {
    // Fetch every recording in the range up front, in a single IMAP session.
    // Limit is generous so we drain the window in one go — far better than
    // wave-based fetching, which used to fragment a customer's call history
    // when it spanned wave boundaries.
    const allMails = await fetchCallRecordingsInRange({
      from: batch.dateFrom,
      to: batch.dateTo,
      limit: 10_000,
    });

    // Group by customer phone hash. Every recording for the same customer
    // becomes one group → one archive row → one trajectory.
    const groupMap = new Map<string, CustomerGroup>();
    for (const m of allMails) {
      const customerPhone = customerPhoneOf(m.subject);
      if (!customerPhone) continue;
      const phoneHash = hashPhone(customerPhone);
      const existing = groupMap.get(phoneHash);
      if (existing) {
        existing.mails.push(m);
      } else {
        groupMap.set(phoneHash, { phoneHash, customerPhone, mails: [m] });
      }
    }

    const allGroups = Array.from(groupMap.values());

    // Resumability: skip groups already saved in a prior run of this batch.
    const alreadyDone = await db
      .select({ phoneHash: conversationArchive.phoneHash })
      .from(conversationArchive)
      .where(eq(conversationArchive.importBatchId, batchId));
    const donePhoneHashes = new Set(
      alreadyDone.map((r) => r.phoneHash).filter((h): h is string => !!h)
    );
    const todoGroups = allGroups.filter(
      (g) => !donePhoneHashes.has(g.phoneHash)
    );

    // itemCount reflects total mail count — this is the user-visible "how many
    // recordings were in your range" number on the UI.
    await db
      .update(archiveImports)
      .set({ itemCount: allMails.length })
      .where(eq(archiveImports.id, batchId));

    for (const group of todoGroups) {
      const elapsed = Date.now() - started;
      const estimated = estimateGroupMs(group);
      // Soft budget: stop entering new groups when we'd run past 230s. The
      // watchdog will still fire at 270s as a safety net if we mis-estimated.
      if (elapsed + estimated > SOFT_BUDGET_MS) {
        hitTimeBudget = true;
        console.log(
          `[archive-phone] deferring group (${group.mails.length} recordings, est ${estimated}ms) — already used ${elapsed}ms`
        );
        break;
      }
      // Belt-and-braces: if the watchdog already fired (mid-loop in some
      // earlier group), don't start another.
      if (watchdogFired) {
        hitTimeBudget = true;
        break;
      }
      const result = await processCustomerGroup(group, batchId, language);
      processedCount += 1;
      if (result.ok) {
        successCount += 1;
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

    const stillHaveTodo = todoGroups.length > processedCount - batch.processedCount;
    const reachedResumeCap = (batch.resumeCount ?? 0) >= MAX_RESUMES;

    // If the watchdog already handled the resume, don't double-update.
    if (watchdogFired) {
      return {
        ok: true,
        batchId,
        status: "processing",
        processedCount,
        successCount,
        failureCount,
        hitTimeBudget: true,
      };
    }

    let finalStatus: "processing" | "done" | "failed";
    let resumeError: string | null = null;
    if (!hitTimeBudget && !stillHaveTodo) {
      finalStatus = "done";
    } else if (hitTimeBudget && !reachedResumeCap) {
      finalStatus = "processing";
    } else if (reachedResumeCap) {
      finalStatus = "failed";
      resumeError = `Reached max self-resume count (${MAX_RESUMES}). Some groups likely failing repeatedly — check logs.`;
    } else {
      finalStatus = "processing";
    }

    await db
      .update(archiveImports)
      .set({
        processedCount,
        successCount,
        failureCount,
        status: finalStatus,
        error: resumeError,
        finishedAt: finalStatus === "done" || finalStatus === "failed" ? new Date() : null,
      })
      .where(eq(archiveImports.id, batchId));

    if (finalStatus === "processing" && hitTimeBudget) {
      await db
        .update(archiveImports)
        .set({ resumeCount: (batch.resumeCount ?? 0) + 1 })
        .where(eq(archiveImports.id, batchId));
      await selfResume(batchId);
    }

    return {
      ok: true,
      batchId,
      status: finalStatus === "failed" ? "failed" : finalStatus,
      processedCount,
      successCount,
      failureCount,
      hitTimeBudget,
    };
  } catch (e) {
    const message = safeErrorMessage(e);
    console.error("[archive-phone] batch crashed", batchId, message);
    await db
      .update(archiveImports)
      .set({
        status: "failed",
        error: message,
        processedCount,
        successCount,
        failureCount,
        finishedAt: new Date(),
      })
      .where(eq(archiveImports.id, batchId));
    return {
      ok: false,
      batchId,
      status: "failed",
      processedCount,
      successCount,
      failureCount,
      hitTimeBudget,
      error: message,
    };
  } finally {
    clearTimeout(watchdog);
  }
}
