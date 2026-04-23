import { db, interactions, leads, pendingEmails } from "@/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { fetchNewMessagesForAddresses, type FetchedMessage } from "./email-imap";
import {
  EMAIL_INGEST_SINCE,
  EMAIL_LAST_SYNC_KEY,
  EMAIL_SYNC_PAUSED_KEY,
  normalizeEmailAddress,
} from "./email-config";
import { getSetting, setSetting } from "./settings";

export interface SyncResult {
  paused: boolean;
  fetched: number;
  deduped: number;
  batchesCreated: number;
  batchesAppended: number;
}

async function loadLastSync(): Promise<Date> {
  const raw = await getSetting(EMAIL_LAST_SYNC_KEY);
  if (!raw) return EMAIL_INGEST_SINCE;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return EMAIL_INGEST_SINCE;
  // Small overlap (5 min) to tolerate clock skew + IMAP SINCE being date-only.
  const OVERLAP_MS = 5 * 60 * 1000;
  return new Date(d.getTime() - OVERLAP_MS);
}

async function saveLastSync(at: Date): Promise<void> {
  await setSetting(EMAIL_LAST_SYNC_KEY, at.toISOString());
}

interface LeadForSync {
  id: string;
  email: string | null;
  aliasEmails: string[];
}

async function loadWatchedLeads(): Promise<LeadForSync[]> {
  return db
    .select({
      id: leads.id,
      email: leads.email,
      aliasEmails: leads.aliasEmails,
    })
    .from(leads);
}

function collectWatchedAddresses(ls: LeadForSync[]): {
  set: Set<string>;
  addressToLeadId: Map<string, string>;
} {
  const set = new Set<string>();
  const addressToLeadId = new Map<string, string>();
  for (const l of ls) {
    if (l.email) {
      const a = normalizeEmailAddress(l.email);
      if (a) {
        set.add(a);
        addressToLeadId.set(a, l.id);
      }
    }
    for (const alias of l.aliasEmails ?? []) {
      const a = normalizeEmailAddress(alias);
      if (a) {
        set.add(a);
        // First lead to claim an address wins — aliasEmails should be unique
        // across leads in practice. If collision, we keep the earlier mapping.
        if (!addressToLeadId.has(a)) addressToLeadId.set(a, l.id);
      }
    }
  }
  return { set, addressToLeadId };
}

/** Return the leadId that matches at least one address in the message, or null. */
function matchMessageToLead(
  m: FetchedMessage,
  addressToLeadId: Map<string, string>
): string | null {
  const from = normalizeEmailAddress(m.from);
  if (addressToLeadId.has(from)) return addressToLeadId.get(from) ?? null;
  for (const t of m.to) {
    const na = normalizeEmailAddress(t);
    if (addressToLeadId.has(na)) return addressToLeadId.get(na) ?? null;
  }
  return null;
}

async function existingMessageIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ messageId: interactions.messageId })
    .from(interactions)
    .where(and(inArray(interactions.messageId, ids), isNotNull(interactions.messageId)));
  return new Set(rows.map((r) => r.messageId).filter((m): m is string => !!m));
}

async function existingPendingMessageIds(
  leadId: string,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  // Any pending_emails row for this lead that holds any of these Message-Ids
  // — whether awaiting review, merged (caught separately via interactions),
  // or dismissed (user already said "no, drop these"). Never re-surface a
  // dismissed message.
  const rows = await db
    .select({ messages: pendingEmails.messages })
    .from(pendingEmails)
    .where(
      and(
        eq(pendingEmails.leadId, leadId),
        inArray(pendingEmails.status, [
          "pending",
          "processing",
          "done",
          "dismissed",
          "merged",
        ])
      )
    );
  const seen = new Set<string>();
  for (const r of rows) {
    const arr = (r.messages as Array<{ messageId?: string }> | null) ?? [];
    for (const m of arr) if (m.messageId) seen.add(m.messageId);
  }
  return seen;
}

/**
 * 4-hour cron worker. Pulls every message from INBOX + Sent that involves any
 * watched lead address, dedups against already-ingested interactions + already-
 * pending rows, groups by lead, and creates one update_batch row per lead.
 *
 * Existing open batches for a lead get appended to instead of creating a
 * second card — the UX is "3 new messages from Yossi", not a stream of cards.
 */
export async function runEmailSync(): Promise<SyncResult> {
  const paused = (await getSetting(EMAIL_SYNC_PAUSED_KEY)) === "true";
  if (paused) {
    return {
      paused: true,
      fetched: 0,
      deduped: 0,
      batchesCreated: 0,
      batchesAppended: 0,
    };
  }

  const ourAddress = process.env.GMAIL_USER;
  if (!ourAddress) {
    throw new Error("GMAIL_USER לא מוגדר ב-env.");
  }

  const since = await loadLastSync();
  const watchedLeads = await loadWatchedLeads();
  const { set: watchedAddresses, addressToLeadId } =
    collectWatchedAddresses(watchedLeads);

  if (watchedAddresses.size === 0) {
    await saveLastSync(new Date());
    return {
      paused: false,
      fetched: 0,
      deduped: 0,
      batchesCreated: 0,
      batchesAppended: 0,
    };
  }

  const syncStartedAt = new Date();
  const msgs = await fetchNewMessagesForAddresses({
    watchedAddresses,
    ourAddress,
    since,
    limit: 500,
  });

  if (msgs.length === 0) {
    await saveLastSync(syncStartedAt);
    return {
      paused: false,
      fetched: 0,
      deduped: 0,
      batchesCreated: 0,
      batchesAppended: 0,
    };
  }

  // Assign each message to a lead (or drop — shouldn't happen since we
  // filtered at IMAP level, but defensive).
  const byLead = new Map<string, FetchedMessage[]>();
  for (const m of msgs) {
    const leadId = matchMessageToLead(m, addressToLeadId);
    if (!leadId) continue;
    const arr = byLead.get(leadId) ?? [];
    arr.push(m);
    byLead.set(leadId, arr);
  }

  // Pull existing messageIds across the whole fetch in one query — avoids
  // per-lead roundtrips.
  const allMessageIds = msgs.map((m) => m.messageId);
  const alreadyInInteractions = await existingMessageIds(allMessageIds);

  let deduped = 0;
  let batchesCreated = 0;
  let batchesAppended = 0;

  for (const [leadId, leadMsgs] of byLead) {
    // Drop messages already in interactions (merged previously).
    const firstPass = leadMsgs.filter((m) => !alreadyInInteractions.has(m.messageId));
    if (firstPass.length === 0) {
      deduped += leadMsgs.length;
      continue;
    }

    // Drop messages already in an open pending_emails row for this lead.
    const alreadyPending = await existingPendingMessageIds(
      leadId,
      firstPass.map((m) => m.messageId)
    );
    const novel = firstPass.filter((m) => !alreadyPending.has(m.messageId));
    deduped += leadMsgs.length - novel.length;
    if (novel.length === 0) continue;

    const messagesJson = novel.map((m) => ({
      messageId: m.messageId,
      from: m.from,
      to: m.to,
      subject: m.subject,
      bodyText: m.bodyText,
      receivedAt: m.receivedAt.toISOString(),
      direction: m.direction,
    }));

    // Prefer appending to an existing open batch row (so the inbox doesn't
    // accumulate multiple cards per lead). Any kind=update_batch row in
    // "done" status is still awaiting the user's review — safe to append.
    const [existing] = await db
      .select({
        id: pendingEmails.id,
        messages: pendingEmails.messages,
        messageCount: pendingEmails.messageCount,
        firstMessageAt: pendingEmails.firstMessageAt,
      })
      .from(pendingEmails)
      .where(
        and(
          eq(pendingEmails.leadId, leadId),
          eq(pendingEmails.kind, "update_batch"),
          eq(pendingEmails.status, "done")
        )
      )
      .orderBy(desc(pendingEmails.createdAt))
      .limit(1);

    const newFirstAt = novel[0]?.receivedAt ?? null;
    const newLastAt = novel.at(-1)?.receivedAt ?? null;

    if (existing) {
      const merged = [
        ...((existing.messages as Array<Record<string, unknown>>) ?? []),
        ...messagesJson,
      ];
      await db
        .update(pendingEmails)
        .set({
          messages: merged,
          messageCount: merged.length,
          firstMessageAt:
            existing.firstMessageAt ?? newFirstAt,
          lastMessageAt: newLastAt ?? existing.firstMessageAt,
        })
        .where(eq(pendingEmails.id, existing.id));
      batchesAppended += 1;
    } else {
      // update_batch rows skip straight to "done" — there's no AI processing
      // step; the messages were already fetched and parsed. The user reviews
      // as soon as the cron finishes.
      await db.insert(pendingEmails).values({
        kind: "update_batch",
        leadId,
        status: "done",
        messages: messagesJson,
        messageCount: messagesJson.length,
        firstMessageAt: newFirstAt,
        lastMessageAt: newLastAt,
        processedAt: new Date(),
      });
      batchesCreated += 1;
    }
  }

  await saveLastSync(syncStartedAt);

  return {
    paused: false,
    fetched: msgs.length,
    deduped,
    batchesCreated,
    batchesAppended,
  };
}
