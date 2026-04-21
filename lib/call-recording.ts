import { db, leads, interactions, appSettings } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
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
  // Bound the set; drop oldest entries (we don't track insert order, so just
  // truncate after Array.from — newest writes still win because Set preserves
  // insertion order in modern JS).
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

const STATUS_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  interested: 2,
  quoted: 3,
  closing: 4,
  booked: 5,
  lost: 5,
};
const PRIORITY_RANK: Record<string, number> = { cold: 0, warm: 1, hot: 2 };

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

  // Content-signature dedup: FreeTelecom re-emails the same recording with a
  // fresh UID every cycle, so UID dedup alone doesn't help. Skip before the
  // expensive Gemini transcribe if we've already processed this exact (subject,
  // date) tuple.
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

  // Mark right after the row lands so a later DB hiccup doesn't leave the
  // signature unrecorded — better to occasionally double-mark than to let a
  // future re-delivery slip through.
  try {
    await markSignatureProcessed(signature);
  } catch (e) {
    console.error("[call-recording] markSignatureProcessed failed", signature, e);
  }

  // Run AI extraction on the transcript (if we have one) and stash the result
  // as a pending review. The user approves or rejects via the /inbox page —
  // we deliberately don't auto-apply because phone transcripts are noisier
  // than WhatsApp and false positives would pollute the lead record.
  //
  // Only NEW leads get pulled into the inbox queue. For existing leads the
  // user already triaged, additional recordings just append to the timeline —
  // otherwise duplicate-emails-per-call from Free Telecom and any new call
  // for an already-known number would yank the lead back into review.
  let pendingExtraction: unknown = null;
  let needsReview = false;
  if (createdNew && transcript && transcript.length > 20) {
    try {
      const { lead: extracted } = await extractLeadFromChat({
        chatText: transcript,
        leadName: null,
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

  // For existing leads, run AI on the aggregate of recent interactions and
  // silently fill in any empty lead fields. This keeps the lead summary
  // coherent across multiple calls — without this, only the very first call
  // ever populates objections/interests/dates/etc.
  if (!createdNew && transcript && transcript.length > 20) {
    try {
      await aggregateAndFillExistingLead(lead.id);
    } catch (e) {
      console.error("[call-recording] aggregate failed for", lead.id, e);
    }
  }

  // Best-effort push so itzik sees the call land while it's still fresh.
  // Failures here must not poison the rest of the pipeline.
  // Skip the push entirely if the email itself is older than 30 minutes —
  // that means we're chewing through a backlog and the user definitely
  // doesn't want a buzz for a call that happened hours ago.
  const PUSH_FRESHNESS_MS = 30 * 60 * 1000;
  const mailAgeMs = Date.now() - mail.date.getTime();
  if (mailAgeMs > PUSH_FRESHNESS_MS) {
    console.log(
      `[call-recording] skipping push for stale recording (age=${Math.round(mailAgeMs / 60000)}m, lead=${lead.id})`
    );
  } else {
    try {
      const isNamed = lead.name && lead.name !== lead.phone;
      const titlePrefix = createdNew ? "ליד חדש · " : "";
      const directionLabel = direction === "in" ? "שיחה נכנסת" : "שיחה יוצאת";
      const title = `${titlePrefix}${directionLabel} — ${isNamed ? lead.name : lead.phone}`;
      const body = transcript
        ? transcript.replace(/\s+/g, " ").trim().slice(0, 140)
        : transcriptionError
          ? "הקלטה הגיעה — תמלול נכשל"
          : "הקלטה הגיעה";
      await sendPushToAll({
        title,
        body,
        url: `/leads/${lead.id}`,
        tag: `call-${lead.id}`,
      });
    } catch (e) {
      console.error("[call-recording] push notify failed", lead.id, e);
    }
  }

  return { uid: mail.uid, status: "ok", leadId: lead.id };
}

/**
 * Re-extracts a lead's profile from its last several interactions and applies
 * fill-if-empty semantics: empty fields get filled, populated fields are never
 * overwritten, tags are unioned, status/priority can only move forward in
 * pipeline rank. Used after a new call recording is appended to a lead the
 * user has already triaged — so additional info doesn't get lost in the
 * interaction timeline alone.
 */
async function aggregateAndFillExistingLead(leadId: string): Promise<void> {
  const [full] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!full) return;

  const recent = await db
    .select({
      content: interactions.content,
      direction: interactions.direction,
    })
    .from(interactions)
    .where(eq(interactions.leadId, leadId))
    .orderBy(desc(interactions.occurredAt))
    .limit(10);

  if (recent.length === 0) return;

  const transcript = recent
    .slice()
    .reverse()
    .map((i) => {
      const speaker =
        i.direction === "out"
          ? "איציק"
          : i.direction === "in"
            ? full.name
            : "[note]";
      return `${speaker}: ${i.content}`;
    })
    .join("\n\n");

  const { lead: extracted } = await extractLeadFromChat({
    chatText: transcript,
    leadName: full.name,
    ourName: "איציק",
    knownLeadId: full.id,
  });

  const update: Record<string, unknown> = {};
  const fillIfEmpty = (field: string, current: unknown, next: unknown) => {
    if (next == null || next === "") return;
    if (current != null && current !== "") return;
    update[field] = next;
  };
  fillIfEmpty("whatSpokeToThem", full.whatSpokeToThem, extracted.whatSpokeToThem);
  fillIfEmpty("objections", full.objections, extracted.objections);
  fillIfEmpty("numAdults", full.numAdults, extracted.numAdults);
  fillIfEmpty("numChildren", full.numChildren, extracted.numChildren);
  fillIfEmpty("agesChildren", full.agesChildren, extracted.agesChildren);
  fillIfEmpty("datesInterest", full.datesInterest, extracted.datesInterest);
  fillIfEmpty("roomTypeInterest", full.roomTypeInterest, extracted.roomTypeInterest);
  fillIfEmpty("budgetSignal", full.budgetSignal, extracted.budgetSignal);

  if (
    extracted.status &&
    extracted.status !== full.status &&
    (STATUS_RANK[extracted.status] ?? -1) > (STATUS_RANK[full.status] ?? -1)
  ) {
    update.status = extracted.status;
  }
  if (
    extracted.priority &&
    extracted.priority !== full.priority &&
    (PRIORITY_RANK[extracted.priority] ?? -1) > (PRIORITY_RANK[full.priority] ?? -1)
  ) {
    update.priority = extracted.priority;
  }

  const existingTags = new Set(full.interestTags ?? []);
  const newTags = (extracted.interestTags ?? []).filter((t) => !existingTags.has(t));
  if (newTags.length > 0) {
    update.interestTags = [...(full.interestTags ?? []), ...newTags];
  }

  if (Object.keys(update).length > 0) {
    update.updatedAt = new Date();
    await db.update(leads).set(update).where(eq(leads.id, leadId));
  }
}
