import { db, leads, interactions } from "@/db";
import { sql } from "drizzle-orm";
import { normalizePhone, phoneTail } from "./phone";
import { transcribeAudio, extractLeadFromChat } from "./ai-client";
import type { CallRecordingMail } from "./gmail-imap";

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
 * Looks up a lead by the last 9 digits of the phone — same fuzzy strategy used
 * for WhatsApp imports, so a lead saved as "+972 50-123-4567" still matches a
 * call from "972501234567".
 */
async function findLeadByPhone(phone: string) {
  const tail = phoneTail(phone);
  if (!tail || tail.length < 9) return null;
  const rows = await db
    .select({ id: leads.id, name: leads.name, phone: leads.phone })
    .from(leads)
    .where(sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9) = ${tail}`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Processes one call-recording email end-to-end:
 *  1. Parse subject for the customer phone (= `from` for inbound calls).
 *  2. Find or create the lead.
 *  3. Transcribe the MP3 attachment via Gemini (already through AI Gateway).
 *  4. Insert an `interactions` row with the transcript as `content`.
 *
 * Returns a brief summary so the cron route can log per-mail outcomes.
 */
export async function processCallRecording(mail: CallRecordingMail): Promise<{
  uid: number;
  status: "ok" | "skipped" | "error";
  leadId?: string;
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

  // Inbound = customer in `from`. Outbound = customer in `to`. Heuristic: the
  // shorter leg is "us" (a short DID) and the longer/mobile-looking leg is the
  // customer. If the from looks like an Israeli mobile (starts with 05), treat
  // it as the customer (inbound).
  const customerPhone =
    /^05/.test(meta.fromPhone) || meta.fromPhone.length > meta.toPhone.length
      ? meta.fromPhone
      : meta.toPhone;
  const direction: "in" | "out" = customerPhone === meta.fromPhone ? "in" : "out";

  let lead = await findLeadByPhone(customerPhone);
  let createdNew = false;
  if (!lead) {
    const [created] = await db
      .insert(leads)
      .values({
        name: customerPhone,
        phone: customerPhone,
        language: "he",
        audience: "israeli_haredi",
        channelFirst: "call",
        status: "new",
        priority: "warm",
      })
      .returning({ id: leads.id, name: leads.name, phone: leads.phone });
    lead = created;
    createdNew = true;
  }

  let transcript = "";
  let transcriptionError: string | undefined;
  try {
    const r = await transcribeAudio(
      new Uint8Array(audio.data),
      audio.mimeType,
      { language: "he", leadId: lead.id, context: "phone_call" }
    );
    transcript = r.transcript;
  } catch (e) {
    transcriptionError = e instanceof Error ? e.message : String(e);
  }

  const header = createdNew
    ? `[שיחת טלפון מ-${customerPhone} — ${mail.date.toLocaleString("he-IL")}]\n(ליד חדש שנוצר אוטומטית מהקלטת השיחה)`
    : `[שיחת טלפון — ${mail.date.toLocaleString("he-IL")}]`;
  const body = transcript
    ? transcript
    : transcriptionError
      ? `[תמלול נכשל: ${transcriptionError}]\n${mail.bodyText.slice(0, 500)}`
      : "[ללא תמלול זמין]";

  await db.insert(interactions).values({
    leadId: lead.id,
    type: direction === "in" ? "call_in" : "call_out",
    direction,
    content: `${header}\n\n${body}`,
    aiSummary: null,
  });

  // Run AI extraction on the transcript (if we have one) and stash the result
  // as a pending review. The user approves or rejects via the /inbox page —
  // we deliberately don't auto-apply because phone transcripts are noisier
  // than WhatsApp and false positives would pollute the lead record.
  let pendingExtraction: unknown = null;
  let needsReview = false;
  if (transcript && transcript.length > 20) {
    try {
      const { lead: extracted } = await extractLeadFromChat({
        chatText: transcript,
        leadName: createdNew ? null : lead.name,
        ourName: "איציק",
        knownLeadId: lead.id,
      });
      pendingExtraction = {
        ...extracted,
        source: "phone_call",
        transcriptPreview: transcript.slice(0, 500),
        extractedAt: new Date().toISOString(),
      };
      needsReview = true;
    } catch (e) {
      console.error("[call-recording] extractLeadFromChat failed", lead.id, e);
    }
  }

  await db
    .update(leads)
    .set({
      updatedAt: new Date(),
      status: sql`case when ${leads.status} = 'new' then 'contacted'::lead_status else ${leads.status} end`,
      ...(needsReview
        ? { needsReview: true, pendingExtraction: pendingExtraction as object }
        : {}),
    })
    .where(sql`${leads.id} = ${lead.id}`);

  return { uid: mail.uid, status: "ok", leadId: lead.id };
}
