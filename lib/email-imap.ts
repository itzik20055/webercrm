import { ImapFlow, type FetchMessageObject } from "imapflow";
import { parseEmail, resolveDirection, type ParsedEmail } from "./email-parser";
import { EMAIL_INGEST_SINCE, isBlockedEmailAddress, normalizeEmailAddress } from "./email-config";

function ensureCreds() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error(
      "GMAIL_USER ו-GMAIL_APP_PASSWORD חייבים להיות מוגדרים ב-env (סיסמת יישום של Google, לא הסיסמה הרגילה)."
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
  return client;
}

/**
 * One normalized message with direction resolved against the operator's own
 * address. `direction === "out"` means *we* sent it; `"in"` means the lead
 * sent it to us.
 */
export interface FetchedMessage extends ParsedEmail {
  direction: "in" | "out";
}

async function fetchFromMailbox(
  client: ImapFlow,
  mailbox: string,
  searchOpts: Record<string, unknown>,
  ourAddress: string,
  limit: number
): Promise<FetchedMessage[]> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const uids = (await client.search(searchOpts as never)) as number[] | null;
    if (!uids || uids.length === 0) return [];

    // Cap fetch size. Take the most-recent UIDs (IMAP returns ascending).
    const take = uids.length > limit ? uids.slice(-limit) : uids;

    const out: FetchedMessage[] = [];
    for await (const msg of client.fetch(take, { uid: true, source: true } as never) as AsyncIterable<FetchMessageObject>) {
      const parsed = await parseEmail(msg.source as Buffer);
      if (!parsed) continue;
      if (isBlockedEmailAddress(parsed.from)) continue;

      out.push({
        ...parsed,
        direction: resolveDirection(parsed.from, parsed.to, ourAddress),
      });
    }
    return out;
  } finally {
    lock.release();
  }
}

/**
 * Pulls every message involving `address` (as From or To) from INBOX and
 * Sent Mail since 2026-04-01. Deduped by Message-Id (same thread can live
 * in both folders — the Sent copy wins for outbound direction).
 *
 * Returned list is sorted oldest→newest so callers can feed it to AI in
 * conversational order.
 */
export async function fetchThreadForAddress(opts: {
  address: string;
  ourAddress: string;
  limit?: number;
}): Promise<FetchedMessage[]> {
  const addr = normalizeEmailAddress(opts.address);
  if (isBlockedEmailAddress(addr)) {
    throw new Error(`הכתובת ${addr} חסומה (no-reply / מערכת). לא ניתן לייבא.`);
  }

  const limit = opts.limit ?? 200;
  const client = await openClient();
  try {
    const search = {
      or: [{ from: addr }, { to: addr }],
      since: EMAIL_INGEST_SINCE,
    };

    const [inboxMsgs, sentMsgs] = await Promise.all([
      fetchFromMailbox(client, "INBOX", search, opts.ourAddress, limit),
      fetchFromMailbox(client, "[Gmail]/Sent Mail", search, opts.ourAddress, limit),
    ]);

    const byMessageId = new Map<string, FetchedMessage>();
    for (const m of inboxMsgs) byMessageId.set(m.messageId, m);
    // Sent wins on conflict (authoritative for outbound direction).
    for (const m of sentMsgs) byMessageId.set(m.messageId, m);

    return Array.from(byMessageId.values()).sort(
      (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
    );
  } finally {
    try {
      await client.logout();
    } catch {
      /* swallow */
    }
  }
}

/**
 * For the sync cron: pull every message since `since` from INBOX + Sent Mail
 * where from/to matches any of the watched addresses. Returns matches grouped
 * by which watched address hit. Caller dedups against existing
 * interactions.messageId.
 *
 * If `since` is older than EMAIL_INGEST_SINCE we clamp to the floor — no
 * matter how stale last_sync_at is, we never dig past 2026-04-01.
 */
export async function fetchNewMessagesForAddresses(opts: {
  watchedAddresses: Set<string>;
  ourAddress: string;
  since: Date;
  limit?: number;
}): Promise<FetchedMessage[]> {
  if (opts.watchedAddresses.size === 0) return [];

  const effectiveSince =
    opts.since.getTime() > EMAIL_INGEST_SINCE.getTime()
      ? opts.since
      : EMAIL_INGEST_SINCE;
  const limit = opts.limit ?? 500;
  const client = await openClient();
  try {
    const [inboxMsgs, sentMsgs] = await Promise.all([
      fetchFromMailbox(
        client,
        "INBOX",
        { since: effectiveSince },
        opts.ourAddress,
        limit
      ),
      fetchFromMailbox(
        client,
        "[Gmail]/Sent Mail",
        { since: effectiveSince },
        opts.ourAddress,
        limit
      ),
    ]);

    const byMessageId = new Map<string, FetchedMessage>();
    for (const m of inboxMsgs) byMessageId.set(m.messageId, m);
    for (const m of sentMsgs) byMessageId.set(m.messageId, m);

    // Filter to only messages involving a watched address.
    const watched = opts.watchedAddresses;
    const hits: FetchedMessage[] = [];
    for (const m of byMessageId.values()) {
      const from = normalizeEmailAddress(m.from);
      const toSet = new Set(m.to.map(normalizeEmailAddress));
      if (watched.has(from) || [...toSet].some((t) => watched.has(t))) {
        hits.push(m);
      }
    }
    return hits.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  } finally {
    try {
      await client.logout();
    } catch {
      /* swallow */
    }
  }
}
