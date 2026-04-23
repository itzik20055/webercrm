import { ilike, or, sql, type SQL } from "drizzle-orm";
import { leads } from "@/db";

/**
 * Smart lead-search condition. Understands phone formatting so typing
 * last digits works regardless of how the stored phone is written —
 * "5555" matches "054-555-5500", "+972 54 555 5500", etc.
 *
 * Columns searched: name, phone (digit-normalized), email, aliasEmails,
 * and notes when includeNotes is true.
 */
export function leadSearchCondition(
  q: string,
  opts: { includeNotes?: boolean } = {}
): SQL | undefined {
  const raw = q.trim();
  if (!raw) return undefined;

  const term = `%${raw}%`;
  const digits = raw.replace(/\D/g, "");

  const conds: SQL[] = [
    ilike(leads.name, term),
    ilike(leads.email, term),
    sql`array_to_string(${leads.aliasEmails}, ' ') ILIKE ${term}`,
  ];

  if (digits.length >= 2) {
    const digitTerm = `%${digits}%`;
    conds.push(
      sql`regexp_replace(${leads.phone}, '\D', '', 'g') ILIKE ${digitTerm}`
    );
  } else {
    conds.push(ilike(leads.phone, term));
  }

  if (opts.includeNotes) {
    conds.push(ilike(leads.notes, term));
  }

  return or(...conds);
}
