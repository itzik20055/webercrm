/**
 * Phone normalization for matching across formats:
 *   "0501234567"    → "0501234567"
 *   "+972501234567" → "0501234567"
 *   "+972 50 123-4567" → "0501234567"
 *   "972501234567"  → "0501234567"
 *   "+1 (555) 123-4567" → "+15551234567"
 */
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  const cleaned = stripBidiAndNormalize(raw);
  const hasPlus = cleaned.trim().startsWith("+");
  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("972") && digits.length >= 11) {
    return "0" + digits.slice(3);
  }
  if (hasPlus && digits.length >= 10) {
    return "+" + digits;
  }
  return digits;
}

/** Returns the last 9 digits — useful as a fuzzy match key. */
export function phoneTail(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.slice(-9);
}

/**
 * WhatsApp injects bidi marks (LRM/RLM/LRE/RLE/PDF/LRO/RLO) and uses fancy
 * dashes (en-dash, em-dash, NBSP) in filenames and messages. Strip those so
 * downstream regex can rely on plain ASCII.
 */
function stripBidiAndNormalize(s: string): string {
  return s
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, "-")
    .replace(/[\u00A0\u2007\u2009\u202F]/g, " ");
}

/**
 * Catches sequences of 7+ digits possibly separated by spaces, dashes, dots,
 * parens, or slashes, optionally prefixed with +. Permissive on purpose —
 * `extractPhones` filters strictly afterwards.
 */
const PHONE_LIKE = /\+?\d[\d\s().\-\/]{5,}\d/g;

/**
 * Decides whether a digit-only string looks like a phone (vs. a WhatsApp
 * timestamp like `20260419162929`, an order ID, etc.). We require a known
 * country/local pattern — a bare 10-digit number with no leading 0/1/+
 * is rejected.
 */
function looksLikePhone(digits: string, hadPlus: boolean): boolean {
  if (digits.length < 9 || digits.length > 15) return false;

  // Reject WhatsApp media timestamps: YYYYMMDDHHMMSS (14 digits, 20XX-21XX).
  if (digits.length === 14 && /^(20|21)\d{12}$/.test(digits)) return false;
  // Reject YYYYMMDD or YYYYMMDDHHMM date-only strings.
  if (digits.length === 8 && /^(20|21)\d{6}$/.test(digits)) return false;
  if (digits.length === 12 && /^(20|21)\d{10}$/.test(digits)) return false;

  // Israeli with country code: 972 + 9 digits.
  if (digits.startsWith("972") && (digits.length === 11 || digits.length === 12)) return true;
  // Israeli local: 0 + 9 digits, second digit is a real prefix
  // (02-04, 08-09 landlines; 05X mobile; 07X cell/VoIP).
  if (/^0[2-9]\d{7,8}$/.test(digits)) return true;
  // US/Canada: 1 + 10 digits.
  if (digits.startsWith("1") && digits.length === 11) return true;
  // Anything else only counts if it had an explicit + (international).
  return hadPlus && digits.length >= 10;
}

export function extractPhones(text: string): string[] {
  if (!text) return [];
  const normalized = stripBidiAndNormalize(text);
  const out = new Set<string>();
  for (const m of normalized.matchAll(PHONE_LIKE)) {
    const raw = m[0];
    const hadPlus = raw.trim().startsWith("+");
    const digits = raw.replace(/\D/g, "");
    if (!looksLikePhone(digits, hadPlus)) continue;
    out.add(normalizePhone(raw));
  }
  return [...out];
}
