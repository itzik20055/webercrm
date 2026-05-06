/**
 * Strips potentially sensitive payloads from an error before it is logged or
 * persisted. Drizzle's NeonDbError bakes the SQL `params` array (which holds
 * user transcripts and PII) into the error message — without this, that text
 * lands in Vercel logs and in the `archive_imports.error` column.
 *
 * Use this anywhere you would log an `Error` from a DB / AI call.
 */
export function safeErrorMessage(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  // "Failed query: <sql with $N placeholders>\nparams: <huge dump>"
  // The SQL itself is harmless (placeholders), but the params line carries
  // the real values — strip it.
  msg = msg.replace(/\nparams:[\s\S]*$/i, "\nparams: [REDACTED]");
  // Truncate aggressively. Long messages encourage the runtime to fall
  // back to the stack trace, which has its own leakage risk.
  if (msg.length > 800) msg = msg.slice(0, 800) + "…";
  return msg;
}
