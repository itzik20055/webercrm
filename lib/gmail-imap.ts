import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

const PROCESSED_LABEL = "weber-processed";

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

/**
 * Pulls unprocessed Call Recording emails from Free Telecom (or any sender
 * matching the subject prefix). "Unprocessed" = lacking the weber-processed
 * Gmail label, which we add after handling. Returns at most `limit` mails to
 * keep cron runs bounded.
 */
export async function fetchPendingCallRecordings(
  limit = 20
): Promise<CallRecordingMail[]> {
  const client = await openClient();
  try {
    const uids = await client.search({
      subject: "Call Recording",
      seen: false,
      keyword: { not: PROCESSED_LABEL },
    } as never);
    if (!uids || uids.length === 0) return [];

    const take = uids.slice(-limit);
    const results: CallRecordingMail[] = [];

    for await (const msg of client.fetch(take, {
      uid: true,
      source: true,
      envelope: true,
    })) {
      try {
        const parsed: ParsedMail = await simpleParser(msg.source as Buffer);
        const attachments = (parsed.attachments ?? [])
          .filter((a) => a.contentType.startsWith("audio/") || /\.mp3$|\.m4a$|\.wav$/i.test(a.filename ?? ""))
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
            (typeof parsed.from === "string" ? parsed.from : "") ?? "",
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
 * Marks the given UIDs as processed by adding our private Gmail label. Gmail
 * exposes labels through IMAP keywords (X-GM-LABELS), and ImapFlow handles
 * label creation on the fly when you add an unknown keyword.
 */
export async function markProcessed(uids: number[]): Promise<void> {
  if (uids.length === 0) return;
  const client = await openClient();
  try {
    await client.messageFlagsAdd(uids, [PROCESSED_LABEL], { uid: true });
  } finally {
    try {
      await client.logout();
    } catch {
      /* swallow */
    }
  }
}
