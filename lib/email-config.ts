/**
 * Hard floor for email ingestion. Anything older than this is never pulled,
 * regardless of what IMAP returns or how a user spells the address. Done at
 * the IMAP query level (SINCE 1-Apr-2026) so old messages never leave Gmail.
 *
 * Stored as UTC midnight of 2026-04-01 in Israel time (IST = UTC+3).
 */
export const EMAIL_INGEST_SINCE = new Date("2026-03-31T21:00:00.000Z");

/**
 * Addresses we never ingest even if the user mistakenly tries. Call-recording
 * notifications, bounce daemons, and generic no-reply senders belong to this
 * list — treating any of them as a lead would pollute the inbox.
 */
const BLOCKED_ADDRESS_PATTERNS = [
  /^donotreply@aloha\.global$/i,
  /^no-?reply@/i,
  /^donot-?reply@/i,
  /^noreply@/i,
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^bounces?[@+]/i,
];

export function isBlockedEmailAddress(addr: string | null | undefined): boolean {
  if (!addr) return true;
  const trimmed = addr.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  return BLOCKED_ADDRESS_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Normalize an email address: trim, lowercase. Gmail treats addresses
 * case-insensitively, so we do too before matching against leads.
 */
export function normalizeEmailAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

export const EMAIL_SYNC_TIMEOUT_MS = 270_000; // match Vercel 300s hard cap
export const EMAIL_SYNC_PAUSED_KEY = "emails_paused";
export const EMAIL_LAST_SYNC_KEY = "emails_last_sync_at";
