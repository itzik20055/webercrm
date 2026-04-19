const PHONE_REGEX = /(?:\+?\d[\d\s\-().]{7,}\d)/g;
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export interface AnonymizationResult {
  anonymized: string;
  placeholderMap: Record<string, string>;
}

export function anonymize(
  text: string,
  knownNames: string[] = []
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

  knownNames.forEach((name, i) => {
    if (!name?.trim()) return;
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
