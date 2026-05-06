import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { eq } from "drizzle-orm";
import { db, appSettings } from "@/db";

const SENDER = "donotreply@aloha.global";
// Short lookback: just enough to catch emails that arrive with a small delay
// from Free Telecom. We never want to dig into the past — only forward.
const LOOKBACK_DAYS = 2;
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
 * Marks every Call Recording email currently visible in the lookback window
 * as "already processed", without actually transcribing them. Used to
 * draw a line in the sand: "everything from here back — ignore; only new
 * emails from this moment forward should be picked up."
 */
export async function skipAllPastCallRecordings(): Promise<{ skipped: number }> {
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
    if (all.length === 0) {
      console.log("[gmail-imap] skip-past: nothing in window");
      return { skipped: 0 };
    }
    await markProcessed(all);
    console.log("[gmail-imap] skip-past: marked", all.length, "as processed");
    return { skipped: all.length };
  } finally {
    try {
      await client.logout();
    } catch {
      /* swallow */
    }
  }
}

/**
 * Locates Gmail's localized "All Mail" folder by its `\All` special-use flag
 * — its display name varies by UI language ("[Gmail]/All Mail", localized
 * variants). Falls back to the English default if the flag isn't present.
 */
async function openAllMail(client: ImapFlow): Promise<string> {
  const boxes = await client.list();
  const allMail = boxes.find((b) => b.specialUse === "\\All");
  const path = allMail?.path ?? "[Gmail]/All Mail";
  await client.mailboxOpen(path);
  return path;
}

/**
 * Counts Call Recording emails in a date range. Operates on `[Gmail]/All Mail`
 * (not the 2-day INBOX window the live cron uses) so historical runs see
 * archived/labeled mail too. Cheap — returns UID counts only, no body fetch.
 */
export async function countCallRecordingsInRange(
  from: Date,
  to: Date
): Promise<{ total: number; mailbox: string }> {
  const client = await openClient();
  try {
    const mailbox = await openAllMail(client);
    const uids = (await client.search({
      from: SENDER,
      subject: "Call Recording",
      since: from,
      before: nextDay(to),
    } as never)) as number[] | null;
    return { total: uids?.length ?? 0, mailbox };
  } finally {
    try {
      await client.logout();
    } catch {
      /* swallow */
    }
  }
}

/**
 * Pulls a window of Call Recording emails matching the date range, with full
 * body + audio attachments. Returns up to `limit` results, ordered by UID
 * ascending (= oldest first within the window). Caller is responsible for
 * tracking which UIDs have been consumed across batched invocations.
 */
export async function fetchCallRecordingsInRange(args: {
  from: Date;
  to: Date;
  excludeUids?: number[];
  limit?: number;
}): Promise<CallRecordingMail[]> {
  const limit = args.limit ?? 5;
  const skip = new Set(args.excludeUids ?? []);

  const client = await openClient();
  try {
    await openAllMail(client);
    const uids = (await client.search({
      from: SENDER,
      subject: "Call Recording",
      since: args.from,
      before: nextDay(args.to),
    } as never)) as number[] | null;

    const all = uids ?? [];
    const remaining = all.filter((u) => !skip.has(u)).sort((a, b) => a - b);
    if (remaining.length === 0) return [];
    const take = remaining.slice(0, limit);

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

function nextDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return next;
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
