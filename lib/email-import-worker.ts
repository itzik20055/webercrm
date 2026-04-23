import { db, leads, pendingEmails } from "@/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { extractLeadFromChat } from "./ai-client";
import { fetchThreadForAddress, type FetchedMessage } from "./email-imap";
import { isBlockedEmailAddress, normalizeEmailAddress } from "./email-config";
import { phoneTail } from "./phone";

export type ImportResult =
  | { ok: true; id: string; status: "done" }
  | { ok: true; status: "no_work" }
  | { ok: false; id?: string; status: "failed"; error: string };

async function claimPending(onlyId?: string) {
  const now = new Date();
  if (onlyId) {
    const claimed = await db
      .update(pendingEmails)
      .set({ status: "processing", processingStartedAt: now })
      .where(
        and(
          eq(pendingEmails.id, onlyId),
          eq(pendingEmails.status, "pending"),
          eq(pendingEmails.kind, "new_import")
        )
      )
      .returning();
    return claimed[0] ?? null;
  }

  const oldest = await db
    .select({ id: pendingEmails.id })
    .from(pendingEmails)
    .where(
      and(
        eq(pendingEmails.status, "pending"),
        eq(pendingEmails.kind, "new_import")
      )
    )
    .orderBy(pendingEmails.createdAt)
    .limit(1);
  if (oldest.length === 0) return null;

  const claimed = await db
    .update(pendingEmails)
    .set({ status: "processing", processingStartedAt: now })
    .where(
      and(
        eq(pendingEmails.id, oldest[0].id),
        eq(pendingEmails.status, "pending")
      )
    )
    .returning();
  return claimed[0] ?? null;
}

async function findMatches(leadName: string | null, phones: string[], emailAddress: string) {
  const conds = [];
  if (leadName) conds.push(ilike(leads.name, `%${leadName}%`));
  for (const phone of phones) {
    const tail = phoneTail(phone);
    if (tail.length >= 7) {
      conds.push(
        sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 9) = ${tail}`
      );
    }
  }
  // Also match leads whose primary email or an alias is the same address.
  conds.push(eq(leads.email, emailAddress));
  conds.push(sql`${emailAddress} = ANY(${leads.aliasEmails})`);

  if (conds.length === 0) return [];
  return db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      status: leads.status,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(or(...conds))
    .orderBy(desc(leads.updatedAt))
    .limit(5);
}

/**
 * Render a fetched thread into a single chat-like text block for the AI.
 * The speaker label uses the actual sender display name (or the email's
 * local-part as a fallback) rather than a hard-coded "[NAME]". `anonymize()`
 * downstream replaces the inferred lead name with "[NAME]" uniformly, so the
 * AI sees a real name to match inside the body text (greetings, signatures,
 * "my name is X" statements).
 */
function renderThreadForAi(
  messages: FetchedMessage[],
  ourName: string,
  leadDisplay: string
): string {
  const lines: string[] = [];
  let lastSubject = "";
  for (const m of messages) {
    if (m.subject && m.subject !== lastSubject) {
      lines.push(`(נושא: ${m.subject})`);
      lastSubject = m.subject;
    }
    const who = m.direction === "out" ? ourName : leadDisplay;
    const ts = m.receivedAt.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
    const header =
      m.direction === "out"
        ? `(אל: ${m.to.join(", ")})`
        : `(מאת: ${m.from}${m.fromName ? ` · "${m.fromName}"` : ""})`;
    const body = m.bodyText.trim();
    lines.push(`[${ts}] ${who} ${header}:\n${body}`);
    lines.push("");
  }
  return lines.join("\n");
}

function prettifyLocalPart(addr: string): string {
  const local = addr.split("@")[0] ?? "";
  if (!local) return "";
  // "sarah.cohen" → "Sarah Cohen", "sarah_cohen" → "Sarah Cohen"
  return local
    .replace(/[._\-]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Best guess at the lead's name for pre-filling the review form.
 * Priority: display name from any inbound "From" header → prettified
 * local-part of the email address → null.
 */
export function guessLeadNameFromMessages(
  messages: FetchedMessage[],
  emailAddress: string
): string | null {
  for (const m of messages) {
    if (m.direction === "in" && m.fromName && m.fromName.trim()) {
      return m.fromName.trim();
    }
  }
  const pretty = prettifyLocalPart(emailAddress);
  return pretty || null;
}

export function extractPhonesFromMessages(messages: FetchedMessage[]): string[] {
  const set = new Set<string>();
  // Very loose — Israeli 10-digit, international +... Up to ~18 chars.
  const re = /(\+?\d[\d\s\-().]{7,17}\d)/g;
  for (const m of messages) {
    const hay = `${m.subject}\n${m.bodyText}`;
    for (const match of hay.matchAll(re)) {
      const digits = match[1].replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) set.add(match[1].trim());
    }
  }
  return Array.from(set).slice(0, 5);
}

/**
 * Process a single queued email-import row. Pulls the whole thread from IMAP,
 * runs AI extraction, matches against existing leads, writes the result back
 * as status="done". On failure → status="failed" (terminal, no auto-retry).
 */
export async function processEmailImport(opts: { id?: string } = {}): Promise<ImportResult> {
  const row = await claimPending(opts.id);
  if (!row) return { ok: true, status: "no_work" };

  try {
    const emailAddress = row.emailAddress;
    if (!emailAddress) {
      throw new Error("הכתובת חסרה בשורת הייבוא.");
    }
    if (isBlockedEmailAddress(emailAddress)) {
      throw new Error(`הכתובת ${emailAddress} חסומה (no-reply/מערכת).`);
    }

    const ourAddress = process.env.GMAIL_USER;
    if (!ourAddress) {
      throw new Error("GMAIL_USER לא מוגדר ב-env.");
    }
    const ourName = process.env.GMAIL_DISPLAY_NAME ?? "איציק";

    const messages = await fetchThreadForAddress({
      address: emailAddress,
      ourAddress,
      limit: 100,
    });

    if (messages.length === 0) {
      throw new Error(
        `לא נמצאו מיילים עם הכתובת ${emailAddress} מאז 1 באפריל 2026. ודא שהכתובת נכונה ושיש התכתבות איתה מהתאריך הזה והלאה.`
      );
    }

    const inferredName = guessLeadNameFromMessages(messages, emailAddress);
    const leadDisplay = inferredName || prettifyLocalPart(emailAddress) || "הלקוח";
    const chatText = renderThreadForAi(messages, ourName, leadDisplay);

    const { lead: extraction } = await extractLeadFromChat({
      chatText,
      leadName: inferredName,
      ourName,
    });

    const phones = extractPhonesFromMessages(messages);
    const matches = await findMatches(
      extraction.customerName ?? inferredName,
      phones,
      normalizeEmailAddress(emailAddress)
    );

    const messagesJson = messages.map((m) => ({
      messageId: m.messageId,
      from: m.from,
      fromName: m.fromName ?? null,
      to: m.to,
      subject: m.subject,
      bodyText: m.bodyText,
      receivedAt: m.receivedAt.toISOString(),
      direction: m.direction,
    }));

    await db
      .update(pendingEmails)
      .set({
        status: "done",
        processedAt: new Date(),
        messages: messagesJson,
        extraction: extraction as object,
        matchCandidateIds: matches.map((m) => m.id),
        messageCount: messages.length,
        firstMessageAt: messages[0]?.receivedAt ?? null,
        lastMessageAt: messages.at(-1)?.receivedAt ?? null,
        error: null,
      })
      .where(eq(pendingEmails.id, row.id));

    return { ok: true, id: row.id, status: "done" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[email-import-worker] failed", row.id, e);
    await db
      .update(pendingEmails)
      .set({
        status: "failed",
        processedAt: new Date(),
        error: message,
      })
      .where(eq(pendingEmails.id, row.id));
    return { ok: false, id: row.id, status: "failed", error: message };
  }
}
