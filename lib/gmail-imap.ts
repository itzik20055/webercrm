import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { eq } from "drizzle-orm";
import { db, appSettings } from "@/db";

const SENDER = "donotreply@aloha.global";
const LOOKBACK_DAYS = 14;
const PROCESSED_KEY = "call_recordings_processed_uids";
const MAX_TRACKED_UIDS = 500;

export interface CallRecordingMail {
  uid: number;
  subject: string;
  date: Date;
  from: string;
  bodyText: string;
  attachments: { filename: string; mimeType: string; data: Buffer }[];
}

function ensureCreds() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER and GMAIL_APP_PASSWORD must be set (use a Google App Password, not your real password)"
    );
  }
  return { user, pass };
}

async function openClient(): Promise<ImapFlow> {
  const { user, pass } = ensureCreds();
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  await client.connect();
  await client.mailboxOpen("INBOX");
  return client;
}

async function loadProcessedUids(): Promise<Set<number>> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, PROCESSED_KEY));
  if (!row?.value) return new Set();
  try {
    const arr = JSON.parse(row.value) as number[];
    return new Set(arr.filter((n) => typeof n === "number"));
  } catch {
    return new Set();
  }
}

async function saveProcessedUids(uids: Set<number>): Promise<void> {
  // Trim to most-recent N to keep the row bounded.
  const arr = Array.from(uids).sort((a, b) => b - a).slice(0, MAX_TRACKED_UIDS);
  const value = JSON.stringify(arr);
  await db
    .insert(appSettings)
    .values({ key: PROCESSED_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Pulls unprocessed Call Recording emails from Free Telecom. "Unprocessed" =
 * UID not in the app_settings.call_recordings_processed_uids set. We use the
 * DB instead of Gmail labels because Gmail's label/keyword semantics over
 * IMAP are inconsistent and hard to verify.
 */
export async function fetchPendingCallRecordings(
  limit = 5
): Promise<CallRecordingMail[]> {
  const processed = await loadProcessedUids();
  console.log("[gmail-imap] loaded", processed.size, "previously processed UIDs");

  const client = await openClient();
  try {
    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);

    const uids = (await client.search({
      from: SENDER,
      subject: "Call Recording",
      since,
    } as never)) as number[] | null;
    console.log(
      "[gmail-imap] IMAP search returned",
      uids?.length ?? 0,
      "uids matching from/subject/since"
    );

    if (!uids || uids.length === 0) return [];

    const pending = uids.filter((u) => !processed.has(u));
    console.log("[gmail-imap]", pending.length, "are unprocessed (excluded", uids.length - pending.length, "already-handled)");

    if (pending.length === 0) return [];

    const take = pending.slice(-limit);
    console.log("[gmail-imap] fetching UIDs:", take);
    const results: CallRecordingMail[] = [];

    for await (const msg of client.fetch(take, {
      uid: true,
      source: true,
      envelope: true,
    })) {
      try {
        const parsed: ParsedMail = await simpleParser(msg.source as Buffer);
        const attachments = (parsed.attachments ?? [])
          .filter(
            (a) =>
              a.contentType.startsWith("audio/") ||
              /\.mp3$|\.m4a$|\.wav$/i.test(a.filename ?? "")
          )
          .map((a) => ({
            filename: a.filename ?? `audio-${Date.now()}.mp3`,
            mimeType: a.contentType || "audio/mpeg",
            data: a.content as Buffer,
          }));

        results.push({
          uid: msg.uid,
          subject: parsed.subject ?? "",
          date: parsed.date ?? new Date(),
          from:
            parsed.from?.value?.[0]?.address ??
            (typeof parsed.from === "string" ? parsed.from : "") ??
            "",
          bodyText: parsed.text ?? "",
          attachments,
        });
      } catch (e) {
        console.error("[gmail-imap] failed to parse message", msg.uid, e);
      }
    }

    return results;
  } finally {
    try {
      await client.logout();
    } catch {
      /* swallow */
    }
  }
}

/**
 * Counts how many Call Recording emails exist in the lookback window and how
 * many are still pending (not yet in the processed set). Cheap preview for
 * the settings UI.
 */
export async function countPendingCallRecordings(): Promise<{
  total: number;
  pending: number;
}> {
  const processed = await loadProcessedUids();
  const client = await openClient();
  try {
    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);
    const uids = (await client.search({
      from: SENDER,
      subject: "Call Recording",
      since,
    } as never)) as number[] | null;
    const all = uids ?? [];
    const pending = all.filter((u) => !processed.has(u));
    return { total: all.length, pending: pending.length };
  } finally {
    try {
      await client.logout();
    } catch {
      /* swallow */
    }
  }
}

/**
 * Clears the processed-UIDs set so every email in the lookback window will be
 * reconsidered. Used when the user wants a fresh backfill (e.g. after
 * deleting leads created from old recordings).
 */
export async function resetProcessedUids(): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: PROCESSED_KEY, value: "[]", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: "[]", updatedAt: new Date() },
    });
  console.log("[gmail-imap] processed UIDs set reset");
}

/**
 * Records the given UIDs in the DB so future cron runs skip them. Trim the
 * stored list to the most recent N UIDs so the row stays small.
 */
export async function markProcessed(uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  const existing = await loadProcessedUids();
  for (const u of uids) existing.add(u);
  await saveProcessedUids(existing);
  console.log("[gmail-imap] marked", uids.length, "UIDs processed; total tracked:", existing.size);
}
