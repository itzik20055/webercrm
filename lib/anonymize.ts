const PHONE_REGEX = /(?:\+?\d[\d\s\-().]{7,}\d)/g;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export interface AnonymizationResult {
  anonymized: string;
  placeholderMap: Record<string, string>;
}

export function anonymize(
  text: string,
  knownNames: string[] = [],
  ourName?: string
): AnonymizationResult {
  const map: Record<string, string> = {};
  let working = text;

  let phoneIdx = 0;
  working = working.replace(PHONE_REGEX, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7) return match;
    phoneIdx += 1;
    const ph = `[PHONE_${phoneIdx}]`;
    map[ph] = match;
    return ph;
  });

  let emailIdx = 0;
  working = working.replace(EMAIL_REGEX, (match) => {
    emailIdx += 1;
    const ph = `[EMAIL_${emailIdx}]`;
    map[ph] = match;
    return ph;
  });

  // Replace our (salesperson) name with [SELF] — but only if it's
  // distinguishable from the lead names. If they collide, the text
  // itself is ambiguous and [SELF] would mislabel lead mentions.
  const trimmedOur = ourName?.trim();
  const leadList = knownNames
    .map((n) => n?.trim())
    .filter((n): n is string => !!n);
  const ourDistinguishable =
    !!trimmedOur && leadList.every((n) => n !== trimmedOur);

  if (ourDistinguishable) {
    const escaped = trimmedOur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    let replaced = false;
    working = working.replace(re, () => {
      replaced = true;
      return "[SELF]";
    });
    if (replaced) map["[SELF]"] = trimmedOur;
  }

  // Sort by length desc so shorter names don't replace inside longer ones
  // (e.g. "אברהם" leaking into "אברהם משה").
  const sortedLead = [...leadList].sort((a, b) => b.length - a.length);
  sortedLead.forEach((name, i) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    const ph = i === 0 ? "[NAME]" : `[NAME_${i + 1}]`;
    let replaced = false;
    working = working.replace(re, () => {
      replaced = true;
      return ph;
    });
    if (replaced) map[ph] = name;
  });

  return { anonymized: working, placeholderMap: map };
}

export function deanonymize(
  text: string,
  placeholderMap: Record<string, string>
): string {
  let working = text;
  for (const [placeholder, original] of Object.entries(placeholderMap)) {
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    working = working.replace(new RegExp(escaped, "g"), original);
  }
  return working;
}
