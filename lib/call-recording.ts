import {
  db,
  leads,
  appSettings,
  pendingCallRecordings,
  type NewPendingCallRecording,
} from "@/db";
import { eq, sql } from "drizzle-orm";
import { normalizePhone, phoneTail } from "./phone";
import { transcribeAudio, extractLeadFromChat } from "./ai-client";
import type { CallRecordingMail } from "./gmail-imap";
import { sendPushToAll } from "./push";

const CALL_SIGNATURES_KEY = "processed_call_signatures";
const MAX_TRACKED_SIGNATURES = 1000;

function buildCallSignature(mail: CallRecordingMail): string {
  // FreeTelecom re-emails the same call with new UIDs. The (subject,date) pair
  // is the only stable identity for a recording across re-deliveries: subject
  // carries [from=>to], date carries the call timestamp.
  return `${mail.subject.trim()}|${mail.date.toISOString()}`;
}

async function loadProcessedSignatures(): Promise<Set<string>> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CALL_SIGNATURES_KEY));
  if (!row?.value) return new Set();
  try {
    const arr = JSON.parse(row.value) as string[];
    return new Set(arr.filter((s) => typeof s === "string"));
  } catch {
    return new Set();
  }
}

async function markSignatureProcessed(sig: string): Promise<void> {
  const existing = await loadProcessedSignatures();
  existing.add(sig);
  const arr = Array.from(existing).slice(-MAX_TRACKED_SIGNATURES);
  const value = JSON.stringify(arr);
  await db
    .insert(appSettings)
    .values({ key: CALL_SIGNATURES_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export interface CallMeta {
  fromPhone: string;
  toPhone: string;
  durationMinutes: number | null;
}

const SUBJECT_RE = /\[(\d{6,15})\s*=>\s*(\d{6,15})\]/;

export function parseCallSubject(subject: string): CallMeta | null {
  const m = subject.match(SUBJECT_RE);
  if (!m) return null;
  return {
    fromPhone: normalizePhone(m[1]),
    toPhone: normalizePhone(m[2]),
    durationMinutes: null,
  };
}

/**
 * Looks up leads by the last 9 digits of the phone — same fuzzy strategy used
 * for WhatsApp imports, so a lead saved as "+972 50-123-4567" still matches a
 * call from "972501234567". Returns up to 5 candidates so the inbox UI can
 * offer them as merge targets.
 */
async function findLeadCandidatesByPhone(phone: string) {
  const tail = phoneTail(phone);
  if (!tail || tail.length < 9) return [] as { id: string; name: string; phone: string }[];
  return db
    .select({ id: leads.id, name: leads.name, phone: leads.phone })
    .from(leads)
    .where(sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9) = ${tail}`)
    .orderBy(sql`updated_at desc`)
    .limit(5);
}

/**
 * Processes one call-recording email end-to-end:
 *  1. Parse subject for the customer phone (= `from` for inbound calls).
 *  2. Skip if we've already seen this (subject,date) tuple.
 *  3. Transcribe the MP3 attachment via Gemini.
 *  4. Run AI extraction on the transcript.
 *  5. Insert a `pending_call_recordings` row — does NOT touch leads.
 *  6. Push notify so the user sees a new item to triage.
 *
 * The user reviews each pending recording in /inbox and chooses to create a
 * new lead, merge into an existing one, or dismiss.
 */
export async function processCallRecording(mail: CallRecordingMail): Promise<{
  uid: number;
  status: "ok" | "skipped" | "error";
  pendingId?: string;
  reason?: string;
}> {
  const meta = parseCallSubject(mail.subject);
  if (!meta) {
    return { uid: mail.uid, status: "skipped", reason: "subject did not match" };
  }
  const audio = mail.attachments[0];
  if (!audio) {
    return { uid: mail.uid, status: "skipped", reason: "no audio attachment" };
  }

  const signature = buildCallSignature(mail);
  const seen = await loadProcessedSignatures();
  if (seen.has(signature)) {
    console.log(`[call-recording] skipping duplicate (signature already processed): ${signature}`);
    return { uid: mail.uid, status: "skipped", reason: "duplicate of already-processed call" };
  }

  // Inbound = customer in `from`. Outbound = customer in `to`. Heuristic: the
  // shorter leg is "us" (a short DID) and the longer/mobile-looking leg is the
  // customer. If the from looks like an Israeli mobile (starts with 05), treat
  // it as the customer (inbound).
  const customerPhone =
    /^05/.test(meta.fromPhone) || meta.fromPhone.length > meta.toPhone.length
      ? meta.fromPhone
      : meta.toPhone;
  const direction: "in" | "out" = customerPhone === meta.fromPhone ? "in" : "out";

  let transcript = "";
  let transcriptionError: string | undefined;
  try {
    const r = await transcribeAudio(
      new Uint8Array(audio.data),
      audio.mimeType,
      { language: "he", context: "phone_call" }
    );
    transcript = r.transcript;
  } catch (e) {
    transcriptionError = e instanceof Error ? e.message : String(e);
  }

  const candidates = await findLeadCandidatesByPhone(customerPhone);

  let extraction: unknown = null;
  if (transcript && transcript.length > 20) {
    try {
      const { lead: extracted } = await extractLeadFromChat({
        chatText: transcript,
        leadName: candidates[0]?.name ?? null,
        ourName: "איציק",
      });
      extraction = extracted;
    } catch (e) {
      console.error("[call-recording] extractLeadFromChat failed", e);
    }
  }

  const insertRow: NewPendingCallRecording = {
    customerPhone,
    direction,
    mailSubject: mail.subject,
    callAt: mail.date,
    transcript: transcript || null,
    transcriptionError: transcriptionError ?? null,
    extraction: extraction as object | null,
    matchCandidateIds: candidates.map((c) => c.id),
  };
  const [created] = await db
    .insert(pendingCallRecordings)
    .values(insertRow)
    .returning({ id: pendingCallRecordings.id });

  // Mark right after the row lands so a later DB hiccup doesn't leave the
  // signature unrecorded — better to occasionally double-mark than to let a
  // future re-delivery slip through.
  try {
    await markSignatureProcessed(signature);
  } catch (e) {
    console.error("[call-recording] markSignatureProcessed failed", signature, e);
  }

  // Best-effort push so itzik sees the call land while it's still fresh.
  // Skip the push entirely if the email itself is older than 30 minutes —
  // that means we're chewing through a backlog and the user definitely
  // doesn't want a buzz for a call that happened hours ago.
  const PUSH_FRESHNESS_MS = 30 * 60 * 1000;
  const mailAgeMs = Date.now() - mail.date.getTime();
  if (mailAgeMs > PUSH_FRESHNESS_MS) {
    console.log(
      `[call-recording] skipping push for stale recording (age=${Math.round(mailAgeMs / 60000)}m, pending=${created.id})`
    );
  } else {
    try {
      const candidateName = candidates[0]?.name;
      const directionLabel = direction === "in" ? "שיחה נכנסת" : "שיחה יוצאת";
      const titlePrefix = candidates.length > 0 ? "" : "ליד חדש · ";
      const subject = candidateName ?? customerPhone;
      const title = `${titlePrefix}${directionLabel} — ${subject}`;
      const body = transcript
        ? transcript.replace(/\s+/g, " ").trim().slice(0, 140)
        : transcriptionError
          ? "הקלטה הגיעה — תמלול נכשל"
          : "הקלטה הגיעה";
      await sendPushToAll({
        title,
        body,
        url: `/inbox`,
        tag: `pending-${created.id}`,
      });
    } catch (e) {
      console.error("[call-recording] push notify failed", created.id, e);
    }
  }

  return { uid: mail.uid, status: "ok", pendingId: created.id };
}
