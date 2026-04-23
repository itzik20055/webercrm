/**
 * Smoke-test the pending_emails queue + interactions.messageId dedup.
 *   [1] schema: pending_emails columns, leads.aliasEmails, interactions.messageId
 *   [2] insert new_import row; duplicate insert with same emailAddress blocked
 *       by the API layer but table itself allows it (we test via the open-row
 *       lookup logic, matching the route).
 *   [3] interactions.messageId UNIQUE globally — second insert of the same id
 *       fails, different leads can't share a messageId.
 *   [4] leads.aliasEmails round-trip.
 * Cleans up after itself.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import {
  db,
  pendingEmails,
  interactions,
  leads,
} from "../db";
import { and, eq, inArray } from "drizzle-orm";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "OK " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\n[1] schema present");
  const cols = (await db.execute(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_name IN ('pending_emails','interactions','leads')
     AND column_name IN ('kind','email_address','messages','extraction','match_candidate_ids',
                         'message_id','alias_emails')`
  )) as unknown as { rows: { table_name: string; column_name: string }[] };
  const present = new Set(
    (cols.rows ?? (cols as unknown as { table_name: string; column_name: string }[])).map(
      (c) => `${c.table_name}.${c.column_name}`
    )
  );
  for (const expected of [
    "pending_emails.kind",
    "pending_emails.email_address",
    "pending_emails.messages",
    "pending_emails.extraction",
    "pending_emails.match_candidate_ids",
    "interactions.message_id",
    "leads.alias_emails",
  ]) {
    record(expected, present.has(expected));
  }

  const cleanupPending: string[] = [];
  const cleanupLeads: string[] = [];
  const cleanupInteractions: string[] = [];

  try {
    console.log("\n[2] pending_emails lifecycle");
    // Insert a new_import row.
    const addr = `smoke-email-${Date.now()}@example.com`;
    const [first] = await db
      .insert(pendingEmails)
      .values({
        kind: "new_import",
        emailAddress: addr,
        status: "pending",
      })
      .returning({ id: pendingEmails.id });
    cleanupPending.push(first.id);
    record("new_import insert", !!first.id);

    // Lookup "open row" like the API does.
    const openRows = await db
      .select({ id: pendingEmails.id, status: pendingEmails.status })
      .from(pendingEmails)
      .where(
        and(
          eq(pendingEmails.kind, "new_import"),
          eq(pendingEmails.emailAddress, addr),
          inArray(pendingEmails.status, ["pending", "processing", "done"])
        )
      );
    record(
      "open-row lookup returns the row",
      openRows.length === 1 && openRows[0].id === first.id,
      `found ${openRows.length}`
    );

    // Mark it as dismissed — a second import of the same address should now
    // be allowed (open-row lookup no longer finds it).
    await db
      .update(pendingEmails)
      .set({ status: "dismissed", resolvedAt: new Date() })
      .where(eq(pendingEmails.id, first.id));

    const afterDismiss = await db
      .select({ id: pendingEmails.id })
      .from(pendingEmails)
      .where(
        and(
          eq(pendingEmails.kind, "new_import"),
          eq(pendingEmails.emailAddress, addr),
          inArray(pendingEmails.status, ["pending", "processing", "done"])
        )
      );
    record(
      "dismissed row hidden from open lookup",
      afterDismiss.length === 0,
      `found ${afterDismiss.length}`
    );

    console.log("\n[3] interactions.messageId UNIQUE globally");
    // Create two throwaway leads, insert the same messageId against the first,
    // try to insert against the second → should fail.
    const [leadA] = await db
      .insert(leads)
      .values({
        name: "Smoke Lead A",
        phone: `+99999${Date.now()}`.slice(0, 15),
      })
      .returning({ id: leads.id });
    cleanupLeads.push(leadA.id);

    const [leadB] = await db
      .insert(leads)
      .values({
        name: "Smoke Lead B",
        phone: `+99998${Date.now()}`.slice(0, 15),
      })
      .returning({ id: leads.id });
    cleanupLeads.push(leadB.id);

    const messageId = `<smoke-${Date.now()}@example.com>`;
    const [ia] = await db
      .insert(interactions)
      .values({
        leadId: leadA.id,
        type: "email",
        direction: "in",
        content: "smoke body",
        messageId,
      })
      .returning({ id: interactions.id });
    cleanupInteractions.push(ia.id);
    record("first messageId insert succeeds", !!ia.id);

    let duplicateFailed = false;
    try {
      await db.insert(interactions).values({
        leadId: leadB.id,
        type: "email",
        direction: "in",
        content: "smoke body 2",
        messageId,
      });
    } catch {
      duplicateFailed = true;
    }
    record(
      "duplicate messageId across leads is rejected",
      duplicateFailed
    );

    console.log("\n[4] leads.aliasEmails round-trip");
    await db
      .update(leads)
      .set({ aliasEmails: ["alias1@example.com", "alias2@example.com"] })
      .where(eq(leads.id, leadA.id));
    const [readBack] = await db
      .select({ aliasEmails: leads.aliasEmails })
      .from(leads)
      .where(eq(leads.id, leadA.id));
    record(
      "aliasEmails stored + read",
      readBack?.aliasEmails?.length === 2 &&
        readBack.aliasEmails.includes("alias1@example.com") &&
        readBack.aliasEmails.includes("alias2@example.com"),
      `${JSON.stringify(readBack?.aliasEmails)}`
    );
  } finally {
    for (const id of cleanupInteractions) {
      await db.delete(interactions).where(eq(interactions.id, id));
    }
    for (const id of cleanupLeads) {
      await db.delete(leads).where(eq(leads.id, id));
    }
    for (const id of cleanupPending) {
      await db.delete(pendingEmails).where(eq(pendingEmails.id, id));
    }
  }

  const fail = checks.filter((x) => !x.ok);
  console.log(`\n=== ${checks.length - fail.length}/${checks.length} passed ===`);
  if (fail.length > 0) {
    console.log("FAILURES:");
    for (const f of fail) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
