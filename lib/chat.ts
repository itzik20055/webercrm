import { and, cosineDistance, desc, eq, gte, isNotNull } from "drizzle-orm";
import {
  db,
  leads,
  interactions,
  productKb,
  voiceExamples,
  type Lead,
  type Interaction,
} from "@/db";
import { MODELS, loadAiRules } from "./ai-client";
import { anonymize } from "./anonymize";
import { embedOne } from "./embeddings";

const POSITIVE_SCORE_THRESHOLD = 0;
const KB_TOP_K = 8;
const KB_MAX_DISTANCE = 0.65;
const VOICE_TOP_K = 5;

const KB_CATEGORY_LABELS: Record<string, string> = {
  hotel: "מלון ומיקום",
  rooms: "חדרים",
  food: "אוכל וכשרות",
  activities: "טיולים ופעילויות",
  prices: "מחירון",
  logistics: "לוגיסטיקה",
  faq: "שאלות והתנגדויות",
};

function formatKb(rows: { category: string; title: string; content: string }[]) {
  const grouped = new Map<string, string[]>();
  for (const r of rows) {
    const arr = grouped.get(r.category) ?? [];
    arr.push(`### ${r.title}\n${r.content}`);
    grouped.set(r.category, arr);
  }
  return Array.from(grouped, ([cat, items]) => {
    const label = KB_CATEGORY_LABELS[cat] ?? cat;
    return `## ${label}\n\n${items.join("\n\n")}`;
  }).join("\n\n");
}

async function retrieveKbForChat(query: string): Promise<string> {
  if (!query.trim()) return "";
  try {
    const queryEmbedding = await embedOne(query);
    const distance = cosineDistance(productKb.embedding, queryEmbedding);
    const rows = await db
      .select({
        category: productKb.category,
        title: productKb.title,
        content: productKb.content,
        distance,
      })
      .from(productKb)
      .where(and(eq(productKb.active, true), isNotNull(productKb.embedding)))
      .orderBy(distance)
      .limit(KB_TOP_K);
    const filtered = rows.filter((r) => Number(r.distance) <= KB_MAX_DISTANCE);
    return filtered.length > 0 ? formatKb(filtered) : "";
  } catch {
    return "";
  }
}

async function retrieveVoiceForChat(args: {
  audience: Lead["audience"];
  language: Lead["language"];
  query: string;
}): Promise<string[]> {
  const baseFilter = and(
    eq(voiceExamples.audience, args.audience),
    eq(voiceExamples.language, args.language),
    gte(voiceExamples.score, POSITIVE_SCORE_THRESHOLD)
  );

  if (args.query.trim()) {
    try {
      const queryEmbedding = await embedOne(args.query);
      const distance = cosineDistance(voiceExamples.embedding, queryEmbedding);
      const rows = await db
        .select({ finalText: voiceExamples.finalText })
        .from(voiceExamples)
        .where(and(baseFilter, isNotNull(voiceExamples.embedding)))
        .orderBy(distance)
        .limit(VOICE_TOP_K);
      if (rows.length > 0) return rows.map((r) => r.finalText);
    } catch {
      // fall through
    }
  }

  const rows = await db
    .select({ finalText: voiceExamples.finalText })
    .from(voiceExamples)
    .where(baseFilter)
    .orderBy(desc(voiceExamples.createdAt))
    .limit(VOICE_TOP_K);
  return rows.map((r) => r.finalText);
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatPromptInput {
  messages: ChatMessage[];
  /** When set, the chat is "about" this lead — system prompt includes profile + recent interactions, retrieval is biased to lead context. */
  leadId?: string | null;
  /** When no lead is selected, picked manually for retrieval scoping. */
  audience?: Lead["audience"];
  language?: Lead["language"];
}

export interface ChatPrompts {
  systemPrompt: string;
  messages: ChatMessage[];
  model: string;
  leadContext: {
    lead: Lead | null;
    recentInteractions: Interaction[];
    placeholderMap: Record<string, string>;
  };
  resolvedAudience: Lead["audience"];
  resolvedLanguage: Lead["language"];
}

/**
 * Builds the system prompt + message list for the chat endpoint.
 *   - With lead: profile + last 10 interactions + scenario-aware retrieval.
 *   - Without lead: trainer-like generic Q&A scoped by audience/language.
 *
 * Anonymization: lead profile and interactions are anonymized before
 * inclusion. The chat's user messages themselves are passed through as-is —
 * they are notes from איציק, not sensitive customer data, and we want the
 * model to see exactly what was asked.
 */
export async function buildChatPrompts(input: ChatPromptInput): Promise<ChatPrompts> {
  const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
  const ragQuery = lastUser?.content ?? "";

  let lead: Lead | null = null;
  let recentInteractions: Interaction[] = [];
  let placeholderMap: Record<string, string> = {};

  if (input.leadId) {
    const [row] = await db.select().from(leads).where(eq(leads.id, input.leadId));
    lead = row ?? null;
    if (lead) {
      recentInteractions = await db
        .select()
        .from(interactions)
        .where(eq(interactions.leadId, lead.id))
        .orderBy(desc(interactions.occurredAt), desc(interactions.id))
        .limit(10);
    }
  }

  const resolvedAudience: Lead["audience"] = lead?.audience ?? input.audience ?? "israeli_haredi";
  const resolvedLanguage: Lead["language"] = lead?.language ?? input.language ?? "he";

  const [kb, rules, voice] = await Promise.all([
    retrieveKbForChat(ragQuery),
    loadAiRules(),
    retrieveVoiceForChat({
      audience: resolvedAudience,
      language: resolvedLanguage,
      query: ragQuery,
    }),
  ]);

  const knowledgeBlock = kb
    ? `\n\n--- ידע על המוצר (השתמש בעובדות מכאן בלבד) ---\n\n${kb}\n\n--- סוף ---\n`
    : "";

  const voiceBlock =
    voice.length > 0
      ? `\n\n--- דוגמאות לסגנון התשובות שלי (חקה את הטון, האורך, בחירת המילים) ---\n\n${voice
          .map((t, i) => `### דוגמה ${i + 1}\n${t}`)
          .join("\n\n")}\n\n--- סוף דוגמאות ---\n`
      : "";

  const rulesBlock = rules.trim()
    ? `\n\n--- כללי כתיבה גלובליים (חובה לפעול לפיהם) ---\n\n${rules.trim()}\n\n--- סוף כללים ---\n`
    : "";

  let leadBlock = "";
  if (lead) {
    const profile = [
      `שם: ${lead.name}`,
      `שפה: ${lead.language}`,
      `קהל: ${lead.audience}`,
      `סטטוס: ${lead.status}`,
      lead.numAdults != null ? `מבוגרים: ${lead.numAdults}` : null,
      lead.numChildren != null ? `ילדים: ${lead.numChildren}` : null,
      lead.agesChildren ? `גילי ילדים: ${lead.agesChildren}` : null,
      lead.datesInterest ? `תאריכים: ${lead.datesInterest}` : null,
      lead.roomTypeInterest ? `חדר: ${lead.roomTypeInterest}` : null,
      lead.budgetSignal ? `תקציב: ${lead.budgetSignal}` : null,
      lead.interestTags?.length ? `התעניין ב: ${lead.interestTags.join(", ")}` : null,
      lead.whatSpokeToThem ? `מה תפס אותו: ${lead.whatSpokeToThem}` : null,
      lead.objections ? `התנגדויות: ${lead.objections}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const interactionsText =
      recentInteractions.length > 0
        ? recentInteractions
            .slice()
            .reverse()
            .map(
              (i) =>
                `[${i.type}] ${new Date(i.occurredAt).toISOString()}: ${i.content.slice(0, 600)}`
            )
            .join("\n\n")
        : "(אין אינטראקציות מתועדות.)";

    const knownNames = [lead.name].filter((n): n is string => !!n);
    const { anonymized: anonProfile, placeholderMap: pm1 } = anonymize(profile, knownNames);
    const { anonymized: anonInteractions, placeholderMap: pm2 } = anonymize(
      interactionsText,
      knownNames
    );
    placeholderMap = { ...pm1, ...pm2 };

    leadBlock = `\n\n--- הקשר הליד שעליו השיחה הזאת (מאונונם) ---\n\n${anonProfile}\n\n### היסטוריית אינטראקציות אחרונות:\n${anonInteractions}\n\n--- סוף הקשר ---\n`;
  }

  const langInstruction =
    resolvedLanguage === "he"
      ? "כתוב בעברית כברירת מחדל. אם איציק כותב לך באנגלית/אידיש, ענה באותה שפה."
      : resolvedLanguage === "en"
        ? "Default to English. If איציק writes to you in Hebrew/Yiddish, mirror it."
        : "כתוב באידיש (אותיות עבריות) כברירת מחדל.";

  const modeInstruction = lead
    ? `אתה עוזר לאיציק לחשוב מה לענות ללקוח ספציפי שהוא ${lead.name}. הוא יכול לשאול אותך לנסח טיוטה, להבין את הלקוח, או לחשוב על אסטרטגיה.`
    : `איציק שואל אותך שאלה כללית של לקוח (לא ליד ספציפי). ענה כאילו אתה הוא עונה ללקוח שכזה — תשובה שיוכל להעתיק/לערוך/לשלוח.`;

  const systemPrompt = `אתה עוזר אישי של איציק, איש מכירות חופשות כשרות באלפים האוסטריים בסנט אנטון עבור Weber Tours. אתה לא בוט מכירות — אתה הוא הקול הפנימי שלו, ה"גרסה היותר טובה" שלו, שעוזרת לו לכתוב מה שיעבוד.

${modeInstruction}

כללים:
1. ענה ישירות וקצר. בלי קלישאות מכירה, בלי אימוג'ים.
2. אל תמכור את מה שכבר משך את הלקוח (כשרות, מנייני תפילה, אלפים) — תתמקד במה שעוד לא ענו עליו או במה שצריך כדי להתקדם.
3. אל תמציא פרטים שאינם בידע. אם חסר מחיר/מועד/פרט — כתוב [X] או "אבדוק ואחזור".
4. כשאיציק מבקש לנסח טיוטה — החזר את הטקסט בלבד, בלי הקדמות או הסברים.
5. כשאיציק מבקש להבין/לחשוב — תוכל להסביר בקצרה, אבל המוקד הוא תועלת מעשית למכירה.
6. ${langInstruction}
${rulesBlock}${knowledgeBlock}${voiceBlock}${leadBlock}`;

  return {
    systemPrompt,
    messages: input.messages,
    model: MODELS.draft,
    leadContext: { lead, recentInteractions, placeholderMap },
    resolvedAudience,
    resolvedLanguage,
  };
}
