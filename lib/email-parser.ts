import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { normalizeEmailAddress } from "./email-config";

export interface ParsedEmail {
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
  receivedAt: Date;
}

/**
 * Strip the quoted-reply part of an email body. Most clients prepend the new
 * text above a marker like "On Mon, Apr 1 2026 at 14:03, X wrote:" or
 * "בתאריך ... מאת ... כתב/ה:". We cut at the first such marker we recognize,
 * leaving only the new content. Signatures are left alone — there's no
 * universal marker and false positives cost more than the clutter.
 */
export function stripQuotedReply(body: string): string {
  if (!body) return body;
  const lines = body.split(/\r?\n/);
  const cutPatterns: RegExp[] = [
    // Gmail / most Western clients
    /^On .{5,80} wrote:\s*$/i,
    // Outlook "-----Original Message-----"
    /^-{2,}\s*original message\s*-{2,}\s*$/i,
    // Hebrew "בתאריך ... מאת ... כתב/ה:"
    /^בתאריך .{3,}(מאת|שלח) .{1,}כתב.{0,2}:\s*$/,
    // Apple Mail / iOS "On ... , at ... , X <email> wrote:"
    /^On\s+.{5,100},\s+at\s+.{2,15},.{5,120}wrote:\s*$/i,
    // Forward header markers (for Fwd cases where user forwarded to self)
    /^-{2,}\s*forwarded message\s*-{2,}\s*$/i,
    /^From:\s.{3,}<.+@.+>\s*$/,
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? "";
    if (cutPatterns.some((p) => p.test(line))) {
      return lines.slice(0, i).join("\n").trimEnd();
    }
    // Consecutive quoted-indicator lines (">") — also a cut boundary.
    if (line.startsWith(">") && i > 0) {
      return lines.slice(0, i).join("\n").trimEnd();
    }
  }
  return body.trimEnd();
}

function firstAddress(addrs: AddressObject | AddressObject[] | undefined): string {
  if (!addrs) return "";
  const list = Array.isArray(addrs) ? addrs : [addrs];
  for (const obj of list) {
    const v = obj?.value?.[0]?.address;
    if (v) return normalizeEmailAddress(v);
  }
  return "";
}

function allAddresses(addrs: AddressObject | AddressObject[] | undefined): string[] {
  if (!addrs) return [];
  const list = Array.isArray(addrs) ? addrs : [addrs];
  const out: string[] = [];
  for (const obj of list) {
    for (const v of obj?.value ?? []) {
      if (v.address) out.push(normalizeEmailAddress(v.address));
    }
  }
  return out;
}

/**
 * Parse a raw RFC 822 message (from IMAP `source`) into our normalized shape.
 * Falls back to HTML → text if no plaintext body exists. Quoted replies are
 * stripped.
 */
export async function parseEmail(source: Buffer): Promise<ParsedEmail | null> {
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(source);
  } catch (e) {
    console.error("[email-parser] simpleParser failed:", e);
    return null;
  }

  const messageId = parsed.messageId?.trim();
  if (!messageId) {
    console.warn("[email-parser] message missing Message-Id, skipping");
    return null;
  }

  const rawBody = parsed.text ?? "";
  const bodyText = stripQuotedReply(rawBody);

  return {
    messageId,
    from: firstAddress(parsed.from),
    to: allAddresses(parsed.to),
    subject: parsed.subject ?? "",
    bodyText,
    receivedAt: parsed.date ?? new Date(),
  };
}

/**
 * Given a message's from/to addresses and the operator's own email, return:
 *   "in"  — the message came from the lead to us
 *   "out" — the message went from us to the lead
 * Direction is resolved at ingest time so the UI doesn't have to figure it
 * out per row.
 */
export function resolveDirection(
  fromAddr: string,
  toAddrs: string[],
  ourAddress: string
): "in" | "out" {
  const our = normalizeEmailAddress(ourAddress);
  if (normalizeEmailAddress(fromAddr) === our) return "out";
  if (toAddrs.map(normalizeEmailAddress).includes(our)) return "in";
  // Neither matches — default to "in" (more conservative: we treat it as
  // something that landed in our inbox).
  return "in";
}
