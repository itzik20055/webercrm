import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import { asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  leads,
  interactions,
  voiceExamples,
  appSettings,
  type Lead,
  type Interaction,
} from "@/db";
import { MODELS } from "./ai-client";
import { anonymize } from "./anonymize";
import { embedOne } from "./embeddings";

/**
 * Nightly learning pipeline — mines איציק's actual messages from completed
 * conversations and saves them as scored voice examples. The score reflects
 * whether the message preceded customer warming (good) or cooling (bad), with
 * a multiplier applied for the lead's final outcome.
 *
 * Filters out leads that won't yield useful signal:
 *   - Won within 24h with < 5 interactions (customer was going to buy anyway)
 *   - Lost with a reason that's about the offer, not the messaging (price/fit)
 *   - Conversations that are too short to evaluate
 *
 * Idempotent: each (lead, message) pair is hashed; re-runs skip duplicates.
 */

const LEARNING_LAST_RUN_KEY = "learning_last_run_at";
const MIN_INTERACTIONS = 2;
const MIN_TOTAL_CONTENT = 200;
const PRICE_LOSS_REASON_RE = /מחיר|תקציב|יקר|לא מתאים|לא רלוונטי|לא בתקציב|too expensive|budget|not a fit/i;

export async function getLearningCursor(): Promise<Date | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, LEARNING_LAST_RUN_KEY))
    .limit(1);
  if (!row) return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function setLearningCursor(at: Date): Promise<void> {
  await db
    .insert(appSettings)
    .values({
      key: LEARNING_LAST_RUN_KEY,
      value: at.toISOString(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: at.toISOString(), updatedAt: new Date() },
    });
}

const ScoredMessageSchema = z.object({
  fullMessage: z
    .string()
    .describe(
      "The complete original message text from איציק, exactly as written in the transcript (after anonymization placeholders). Must be a substring of one of his interactions."
    ),
  scenario: z.enum([
    "first_reply",
    "send_price",
    "price_objection",
    "silent_followup",
    "date_confirmation",
    "closing_request",
    "general",
  ]),
  scenarioTag: z
    .string()
    .describe(
      "Fine-grained free-text tag: 'kashrut_question_response', 'price_anchor', 'date_negotiation', 'objection_value_reframe', etc. Two words max, snake_case, English."
    ),
  score: z
    .number()
    .min(-1)
    .max(1)
    .describe(
      "Effectiveness score. +1.0 = caused clear warming (customer asked detailed questions, requested price, mentioned commitment, moved pipeline forward). +0.5 = solid effective response. 0 = neutral. -0.5 = preceded customer cooling. -1.0 = clearly counterproductive (preceded silence, customer wrote 'אחזור אליך'/'אחשוב', led to loss)."
    ),
  rationale: z
    .string()
    .describe("One Hebrew sentence: WHY this score. Reference the customer's reaction in the next message(s)."),
  outcomeSignals: z.object({
    warmedAfter: z.boolean(),
    cooledAfter: z.boolean(),
    ledToQuestion: z.boolean(),
    precededSilence: z.boolean(),
  }),
});

const MiningResultSchema = z.object({
  excludeFromTraining: z
    .boolean()
    .describe(
      "True if the conversation has too little signal (info request without engagement, generic ping-pong, customer not really a buyer)."
    ),
  excludeReason: z.string().nullable(),
  scoredMessages: z
    .array(ScoredMessageSchema)
    .describe(
      "ONLY include messages from איציק that are substantive AND have a clear customer reaction visible in the transcript. Skip generic acknowledgements ('בסדר', 'תודה', 'אוקיי'). Aim for the 1-5 most informative messages — quality over quantity."
    ),
});

const SYSTEM_PROMPT = `אתה מנתח שיחות מכירה של איציק (איש מכירות חופשות כשרות באלפים האוסטריים, סנט אנטון) עבור Weber Tours. תפקידך: לחלץ מההיסטוריה את ההודעות שלו שאפשר ללמוד מהן — מה עבד, מה לא — כדי לאמן את ה־AI לכתוב כמו "הגרסה היותר טובה שלו".

הקלט: תמלול מלא של כל האינטראקציות עם הליד (וואטסאפ + תמלולי טלפון + הערות), עם תיוג של מי דיבר. הליד מאונונם — שם הלקוח כ־[NAME], טלפונים [PHONE_X], מיילים [EMAIL_X].

עקרונות הניקוד:

**אותות חיוביים** (הציון של ההודעה צריך להיות גבוה +0.5 עד +1.0):
- אחרי ההודעה הלקוח שאל שאלות מפורטות (מחיר, גודל חדר, תאריכים, אוכל, מסלולים)
- הלקוח השתמש בלשון מחויבות ("נשמע מצוין", "נסגור", "מתי אפשר", "תשלח לי הצעה")
- הלקוח הזכיר בני משפחה לקבלת החלטה ("נדבר עם אשתי", "אבדוק עם אמא")
- הלקוח עבר שלב בפייפליין באותו יום (ראייה: ה־status התקדם ב־DB אחרי ההודעה)
- בליד שנסגר ב־booked — הודעות שתרמו לסגירה

**אותות שליליים** (ציון נמוך −0.5 עד −1.0):
- אחרי ההודעה הלקוח שתק 5+ ימים (שינוי תאריכים בין הודעות)
- הלקוח כתב "אחשוב על זה" / "אחזור אליך" / "תודה, נחזור" / "let me think" / "I'll get back to you"
- הלקוח שאל על מתחרים אחרי ההודעה
- בליד שאבד (lost) — הודעות שלפי ההקשר תרמו לאובדן

**ציון 0 או דלג על ההודעה**:
- אישורים גנריים ("בסדר", "תודה", "אוקיי", "מעולה")
- הודעות לוגיסטיות נטו (תאריך פגישה, אישור)
- הודעות קצרות מאוד (< 30 תווים) ללא תוכן מהותי

**מתי לסמן excludeFromTraining=true**:
- השיחה כולה היא רק שאלת מידע ללא מעורבות אמיתית של הלקוח (3 הודעות, הלקוח שאל ועזב)
- הלקוח לא היה אמיתי (בדיקת מחיר, סקרנות בלבד)
- אין שום הודעה משמעותית של איציק שאפשר ללמוד ממנה

**כללי איכות**:
- בחר רק 1-5 הודעות המשמעותיות ביותר. עדיף איכות על כמות.
- ה־fullMessage חייב להיות **טקסט מילולי** של הודעה אחת של איציק מהתמלול. אל תחבר כמה הודעות.
- ה־rationale חייב להפנות לתגובת הלקוח. דוגמה טובה: "אחרי ההודעה הזאת הלקוח שאל מיד על מחירי חדרים — סימן חימום ברור."`;

function hashMessage(leadId: string, message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(`${leadId}::${normalized}`)
    .digest("hex");
}

function shouldSkipLead(lead: Lead, leadInteractions: Interaction[]): string | null {
  if (leadInteractions.length < MIN_INTERACTIONS) return "too_few_interactions";

  const totalLen = leadInteractions.reduce((s, i) => s + (i.content?.length ?? 0), 0);
  if (totalLen < MIN_TOTAL_CONTENT) return "too_short";

  if (lead.status === "booked") {
    const first = leadInteractions[0]?.occurredAt;
    const last = leadInteractions[leadInteractions.length - 1]?.occurredAt;
    if (first && last) {
      const elapsed = new Date(last).getTime() - new Date(first).getTime();
      if (elapsed < 24 * 60 * 60 * 1000 && leadInteractions.length < 5) {
        return "won_too_fast";
      }
    }
  }

  if (
    lead.status === "lost" &&
    lead.lostReason &&
    PRICE_LOSS_REASON_RE.test(lead.lostReason)
  ) {
    return "lost_on_price_or_fit";
  }

  return null;
}

export interface MineLeadResult {
  leadId: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
  saved?: number;
  duplicates?: number;
}

export async function mineLeadConversation(
  lead: Lead,
  leadInteractions: Interaction[]
): Promise<MineLeadResult> {
  const skipReason = shouldSkipLead(lead, leadInteractions);
  if (skipReason) return { leadId: lead.id, status: "skipped", reason: skipReason };

  const speakerLabel = (i: Interaction) =>
    i.direction === "out"
      ? "איציק"
      : i.direction === "in"
        ? lead.name
        : "[פנימי]";

  const transcript = leadInteractions
    .map(
      (i) =>
        `=== [${i.type} | ${speakerLabel(i)}] ${new Date(i.occurredAt).toISOString()} ===\n${i.content}`
    )
    .join("\n\n");

  const { anonymized } = anonymize(
    transcript,
    [lead.name].filter((n): n is string => !!n)
  );

  let mining;
  try {
    const { object } = await generateObject({
      model: MODELS.learning,
      schema: MiningResultSchema,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `סטטוס סופי של הליד: ${lead.status}${
            lead.lostReason ? ` (סיבה: ${lead.lostReason})` : ""
          }\nעדיפות נוכחית: ${lead.priority}\nשפה: ${lead.language}\nקהל: ${lead.audience}\n\n${anonymized}`,
        },
      ],
    });
    mining = object;
  } catch (e) {
    return {
      leadId: lead.id,
      status: "error",
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  if (mining.excludeFromTraining) {
    return { leadId: lead.id, status: "skipped", reason: mining.excludeReason ?? "ai_excluded" };
  }

  // Outcome multiplier — booked leads get a boost, lost leads (that weren't
  // already filtered as price-only losses) get a haircut.
  const outcomeMultiplier =
    lead.status === "booked" ? 1.3 : lead.status === "lost" ? 0.7 : 1.0;

  let saved = 0;
  let duplicates = 0;
  for (const msg of mining.scoredMessages) {
    if (!msg.fullMessage?.trim()) continue;

    const hash = hashMessage(lead.id, msg.fullMessage);
    const existing = await db
      .select({ id: voiceExamples.id })
      .from(voiceExamples)
      .where(eq(voiceExamples.messageHash, hash))
      .limit(1);
    if (existing.length > 0) {
      duplicates += 1;
      continue;
    }

    // Anonymize the saved message — protects PII from leaking back into future
    // few-shot drafts. Names will be reinjected via deanonymize at draft time
    // only if איציק chooses a customer with the same name.
    const { anonymized: anonMsg } = anonymize(
      msg.fullMessage,
      [lead.name].filter((n): n is string => !!n)
    );

    const adjusted = Math.max(-1, Math.min(1, msg.score * outcomeMultiplier));

    let embedding: number[] | null = null;
    try {
      embedding = await embedOne(anonMsg);
    } catch {
      embedding = null;
    }

    try {
      await db.insert(voiceExamples).values({
        leadId: lead.id,
        scenario: msg.scenario,
        language: lead.language,
        audience: lead.audience,
        aiDraft: "",
        finalText: anonMsg,
        contextSnapshot: {
          rationale: msg.rationale,
          fromLearningCron: true,
        },
        embedding,
        embeddedAt: embedding ? new Date() : null,
        source: "auto_outcome",
        score: adjusted,
        scenarioTag: msg.scenarioTag,
        outcomeSignals: msg.outcomeSignals,
        messageHash: hash,
      });
      saved += 1;
    } catch (e) {
      // Most likely a unique-index race; safe to ignore.
      const errMsg = e instanceof Error ? e.message : String(e);
      if (!/duplicate|unique/i.test(errMsg)) {
        console.error("[learning] failed to insert example", lead.id, errMsg);
      } else {
        duplicates += 1;
      }
    }
  }

  return { leadId: lead.id, status: "ok", saved, duplicates };
}

async function processCandidates(
  candidateIds: string[]
): Promise<MineLeadResult[]> {
  if (candidateIds.length === 0) return [];

  const fullLeads = await db
    .select()
    .from(leads)
    .where(inArray(leads.id, candidateIds));

  const allInteractions = await db
    .select()
    .from(interactions)
    .where(inArray(interactions.leadId, candidateIds))
    .orderBy(asc(interactions.occurredAt), asc(interactions.id));

  const byLead = new Map<string, Interaction[]>();
  for (const i of allInteractions) {
    const arr = byLead.get(i.leadId) ?? [];
    arr.push(i);
    byLead.set(i.leadId, arr);
  }

  const processed: MineLeadResult[] = [];
  for (const lead of fullLeads) {
    const leadInteractions = byLead.get(lead.id) ?? [];
    try {
      const result = await mineLeadConversation(lead, leadInteractions);
      processed.push(result);
    } catch (e) {
      processed.push({
        leadId: lead.id,
        status: "error",
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return processed;
}

/**
 * Finds leads whose conversations have changed since the last cursor and mines
 * them. Processed oldest-activity-first so that when the leadLimit cap is hit,
 * the cursor only advances past the frontier we actually processed — leaving
 * newer-but-unprocessed leads for the next run (instead of losing them).
 */
export async function runLearningPass({
  leadLimit = 30,
}: { leadLimit?: number } = {}): Promise<{
  ok: boolean;
  cursor: string | null;
  newCursor: string;
  processed: MineLeadResult[];
  durationMs: number;
}> {
  const start = Date.now();
  const cursor = await getLearningCursor();

  const activitySubquery = db
    .select({
      leadId: interactions.leadId,
      lastActivity: sql<Date>`max(${interactions.occurredAt})`.as("last_activity"),
    })
    .from(interactions)
    .where(cursor ? gt(interactions.occurredAt, cursor) : undefined)
    .groupBy(interactions.leadId)
    .as("recent");

  const candidates = await db
    .select({
      id: leads.id,
      lastActivity: activitySubquery.lastActivity,
    })
    .from(activitySubquery)
    .innerJoin(leads, eq(leads.id, activitySubquery.leadId))
    .orderBy(asc(activitySubquery.lastActivity), asc(leads.id))
    .limit(leadLimit);

  if (candidates.length === 0) {
    const newCursor = new Date(start);
    await setLearningCursor(newCursor);
    return {
      ok: true,
      cursor: cursor?.toISOString() ?? null,
      newCursor: newCursor.toISOString(),
      processed: [],
      durationMs: Date.now() - start,
    };
  }

  const processed = await processCandidates(candidates.map((c) => c.id));

  // If we drained the queue (fewer candidates than the cap), jump to `start`.
  // Otherwise, advance only up to the newest activity we actually processed,
  // minus 1ms so any lead tied on the boundary is re-caught next run.
  // Hash dedup in mineLeadConversation absorbs the re-processing cost.
  const drained = candidates.length < leadLimit;
  const maxProcessed = new Date(
    candidates[candidates.length - 1].lastActivity
  ).getTime();
  const newCursor = drained ? new Date(start) : new Date(maxProcessed - 1);
  await setLearningCursor(newCursor);

  return {
    ok: true,
    cursor: cursor?.toISOString() ?? null,
    newCursor: newCursor.toISOString(),
    processed,
    durationMs: Date.now() - start,
  };
}

/**
 * One-shot backfill over all historical leads, paginated. Ignores the cursor
 * entirely so it can run alongside the nightly cron without interfering. Use
 * this to seed voice_examples from conversations that pre-date the cron or
 * that fell through the cap before the cursor-advance fix.
 */
export async function runLearningBackfill({
  page = 0,
  size = 30,
}: { page?: number; size?: number } = {}): Promise<{
  ok: boolean;
  page: number;
  size: number;
  hasMore: boolean;
  processed: MineLeadResult[];
  durationMs: number;
}> {
  const start = Date.now();
  const pageSize = Math.max(1, Math.min(50, size));
  const offset = Math.max(0, page) * pageSize;

  const activitySubquery = db
    .select({
      leadId: interactions.leadId,
      lastActivity: sql<Date>`max(${interactions.occurredAt})`.as("last_activity"),
    })
    .from(interactions)
    .groupBy(interactions.leadId)
    .as("recent");

  const batch = await db
    .select({
      id: leads.id,
      lastActivity: activitySubquery.lastActivity,
    })
    .from(activitySubquery)
    .innerJoin(leads, eq(leads.id, activitySubquery.leadId))
    .orderBy(asc(activitySubquery.lastActivity), asc(leads.id))
    .limit(pageSize + 1)
    .offset(offset);

  const hasMore = batch.length > pageSize;
  const candidates = batch.slice(0, pageSize);

  const processed = await processCandidates(candidates.map((c) => c.id));

  return {
    ok: true,
    page,
    size: pageSize,
    hasMore,
    processed,
    durationMs: Date.now() - start,
  };
}
