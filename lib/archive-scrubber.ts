/**
 * Removes information from archive transcripts that we explicitly do NOT want
 * the learning pipeline to memorize: absolute prices and absolute calendar
 * dates/times. The user's tour pricing changes year-over-year and prayer
 * timings change with daylight savings — letting the LLM ingest old values
 * verbatim would poison the knowledge base.
 *
 * What we DO want preserved:
 *   - Seasonal language ("פסח", "סוכות", "חורף", "בין הזמנים") — drives style
 *   - Relative timing ("3 ימים אחרי", "מחר", "לפני שבוע") — drives cadence
 *   - Quantity language without currency ("4 ילדים", "10 לילות")
 *
 * Replacement strategy: tokens, not deletion. The LLM extractor sees that a
 * price was discussed without learning the number — `<מחיר>` is a clearer
 * signal than a hole in the sentence.
 */

const CURRENCY_AFTER =
  /\b\d{1,3}(?:[,.]\d{3})*(?:[.,]\d+)?\s*(?:₪|ש["׳]?ח|שקל(?:ים)?|\$|USD|דולר(?:ים)?|€|EUR|אירו|£|GBP|פאונד)/giu;
const CURRENCY_BEFORE =
  /(?:₪|\$|€|£|USD|EUR|GBP)\s*\d{1,3}(?:[,.]\d{3})*(?:[.,]\d+)?/giu;
// Bare numeric ranges that are clearly prices in context: "1500-2000",
// "1,500 ל-2,000". These hit only when at least one side has 4+ digits to
// avoid eating room counts ("חדר 12-14") or kid ages.
const PRICE_RANGE =
  /\b\d{1,3}(?:[,.]\d{3})+(?:\s*[-–עד\sל]+\s*\d{1,3}(?:[,.]\d{3})+)?/g;
const DATE_NUMERIC =
  /\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?\b/g;
// Times in HH:MM. Phone numbers don't follow this pattern (they have at least
// 7 contiguous digits or a dash) so this is safe.
const TIME_HH_MM = /\b\d{1,2}:\d{2}\b/g;

export interface ScrubResult {
  text: string;
  removedPrices: number;
  removedDates: number;
  removedTimes: number;
}

export function scrubArchiveText(input: string): ScrubResult {
  let removedPrices = 0;
  let removedDates = 0;
  let removedTimes = 0;

  let out = input;

  out = out.replace(CURRENCY_AFTER, () => {
    removedPrices += 1;
    return "<מחיר>";
  });
  out = out.replace(CURRENCY_BEFORE, () => {
    removedPrices += 1;
    return "<מחיר>";
  });
  out = out.replace(PRICE_RANGE, () => {
    removedPrices += 1;
    return "<מחיר>";
  });
  out = out.replace(DATE_NUMERIC, () => {
    removedDates += 1;
    return "<תאריך>";
  });
  out = out.replace(TIME_HH_MM, () => {
    removedTimes += 1;
    return "<שעה>";
  });

  // Collapse runs of <מחיר> tokens that came from successive replacements.
  out = out
    .replace(/(?:<מחיר>\s*){2,}/g, "<מחיר> ")
    .replace(/(?:<תאריך>\s*){2,}/g, "<תאריך> ")
    .replace(/(?:<שעה>\s*){2,}/g, "<שעה> ")
    // Whitespace cleanup from cascading replacements.
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n");

  return { text: out, removedPrices, removedDates, removedTimes };
}
