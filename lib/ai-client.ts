import { generateObject, generateText } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, aiAuditLog, productKb } from "@/db";
import { anonymize, deanonymize } from "./anonymize";

/** Models we use through Vercel AI Gateway. */
export const MODELS = {
  /**
   * Text extraction. Sonnet handles Hebrew nuance and avoids the hallucinations
   * Haiku produces on multilingual sales conversations. Bumped from Haiku 4.5
   * after seeing garbled output on real chats.
   */
  extract: "anthropic/claude-sonnet-4.6",
  /** Multimodal — accepts audio file input for transcription. */
  transcribe: "google/gemini-2.5-flash",
} as const;

function ensureGatewayKey() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "AI_GATEWAY_API_KEY is not set. Get a key at https://vercel.com/dashboard/ai/api-keys and add it to .env.local"
    );
  }
}

const KB_TTL_MS = 60_000;
let kbCache: { text: string; loadedAt: number } | null = null;

const KB_CATEGORY_LABELS: Record<string, string> = {
  hotel: "מלון ומיקום",
  rooms: "חדרים",
  food: "אוכל וכשרות",
  activities: "טיולים ופעילויות",
  prices: "מחירון",
  logistics: "לוגיסטיקה (תפילות, שדות תעופה, תשתיות)",
  faq: "שאלות, התנגדויות, מדיניות",
};

/**
 * Loads the product knowledge base, formatted for system-prompt injection.
 * Cached for 60s so back-to-back AI calls don't hammer the DB. Falls back to
 * an empty block on failure — knowledge is augmentation, never a hard
 * dependency.
 */
async function loadKnowledgeContext(): Promise<string> {
  const now = Date.now();
  if (kbCache && now - kbCache.loadedAt < KB_TTL_MS) return kbCache.text;
  try {
    const rows = await db
      .select({
        category: productKb.category,
        title: productKb.title,
        content: productKb.content,
      })
      .from(productKb)
      .where(eq(productKb.active, true));
    if (rows.length === 0) {
      kbCache = { text: "", loadedAt: now };
      return "";
    }
    const grouped = new Map<string, string[]>();
    for (const r of rows) {
      const arr = grouped.get(r.category) ?? [];
      arr.push(`### ${r.title}\n${r.content}`);
      grouped.set(r.category, arr);
    }
    const sections: string[] = [];
    for (const [cat, items] of grouped) {
      const label = KB_CATEGORY_LABELS[cat] ?? cat;
      sections.push(`## ${label}\n\n${items.join("\n\n")}`);
    }
    const text = sections.join("\n\n");
    kbCache = { text, loadedAt: now };
    return text;
  } catch {
    return "";
  }
}

/**
 * Transcribes an audio file using Gemini 2.5 Flash via AI Gateway.
 * Audio is sent as a binary file part in a chat completion (Gemini supports
 * native audio input). We do NOT anonymize the audio itself — it goes through
 * the gateway with ZDR.
 */
export async function transcribeAudio(
  audio: Uint8Array,
  mediaType: string,
  opts: { language?: "he" | "en" | "yi"; leadId?: string } = {}
): Promise<{ transcript: string; durationMs: number }> {
  ensureGatewayKey();
  const start = Date.now();

  const langHint =
    opts.language === "he"
      ? "The audio is most likely in Hebrew."
      : opts.language === "yi"
        ? "The audio is most likely in Yiddish."
        : opts.language === "en"
          ? "The audio is most likely in English."
          : "The audio may be in Hebrew, English, or Yiddish.";

  let transcript = "";
  let error: string | undefined;
  try {
    const { text } = await generateText({
      model: MODELS.transcribe,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Transcribe this audio message verbatim, preserving the original language. ${langHint}\n\nReturn ONLY the transcript text. No preamble, no explanation, no formatting.`,
            },
            {
              type: "file",
              data: audio,
              mediaType,
            },
          ],
        },
      ],
    });
    transcript = text.trim();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const durationMs = Date.now() - start;
    // Audit log: store mediaType + length, not audio bytes themselves.
    await db
      .insert(aiAuditLog)
      .values({
        operation: "transcribe",
        model: MODELS.transcribe,
        inputAnonymized: `[audio ${mediaType} ${audio.byteLength} bytes]`,
        output: transcript || null,
        leadId: opts.leadId ?? null,
        durationMs,
        error: error ?? null,
      })
      .catch(() => {});
  }
  return { transcript, durationMs: Date.now() - start };
}

/** Schema for what Claude extracts from an anonymized chat. */
const ExtractedLeadSchema = z.object({
  language: z.enum(["he", "en", "yi"]).describe("Primary language of the lead"),
  audience: z
    .enum(["israeli_haredi", "american_haredi", "european_haredi"])
    .describe(
      "Best guess at the lead's audience based on language style and references"
    ),
  numAdults: z.number().int().nullable(),
  numChildren: z.number().int().nullable(),
  agesChildren: z.string().nullable().describe("e.g. '5, 8, 12' or null"),
  datesInterest: z
    .string()
    .nullable()
    .describe("Dates they showed interest in, e.g. '1-7 August'"),
  roomTypeInterest: z.string().nullable(),
  budgetSignal: z.enum(["low", "mid", "high"]).nullable(),
  interestTags: z
    .array(
      z.enum([
        "hotel",
        "food",
        "trips",
        "spa",
        "pool",
        "minyan",
        "kids",
        "shabbat",
        "flights",
        "views",
      ])
    )
    .describe("Topics the lead asked or cared about"),
  whatSpokeToThem: z
    .string()
    .nullable()
    .describe(
      "What seemed to excite or interest them most. 1-2 short sentences in Hebrew."
    ),
  objections: z
    .string()
    .nullable()
    .describe(
      "Concerns, hesitations or objections they raised. 1-2 sentences in Hebrew."
    ),
  status: z
    .enum([
      "new",
      "contacted",
      "interested",
      "quoted",
      "closing",
      "booked",
      "lost",
    ])
    .describe("Current state of the deal based on the conversation"),
  priority: z
    .enum(["hot", "warm", "cold"])
    .describe("How likely they are to book based on engagement"),
  summary: z
    .string()
    .describe("3-bullet summary in Hebrew of what happened in this chat"),
  suggestedFollowupHours: z
    .number()
    .int()
    .nullable()
    .describe(
      "Hours from NOW until the next followup. null only if status is 'booked' or 'lost'."
    ),
  suggestedFollowupReason: z
    .string()
    .nullable()
    .describe(
      "סיבה קצרה לפולואפ בעברית, כולל הקשר. e.g. 'מחכה לתשובה מהאישה — אמר שיענה תוך יומיים' או 'הצעת מחיר נשלחה אתמול, נותן לו זמן לעכל'"
    ),
  followupReasoning: z
    .string()
    .describe(
      "ההיגיון מאחורי הבחירה של מועד הפולואפ. לדוגמה: 'הלקוח אמר במפורש לחזור אליו ביום ראשון בערב' או 'התלהב מאוד אבל לא ביקש מועד; 48 שעות מספיק כדי שיתבשל ולא יישכח'."
    ),
});

export type ExtractedLead = z.infer<typeof ExtractedLeadSchema>;

export interface ExtractInput {
  chatText: string;
  leadName: string | null;
  ourName: string;
  knownLeadId?: string;
}

export interface ExtractOutput {
  lead: ExtractedLead;
  durationMs: number;
}

/**
 * Sends an (anonymized) chat to Claude and extracts a structured lead profile.
 * Anonymization happens here — phones, emails, and names are stripped before
 * the text leaves our process.
 */
export async function extractLeadFromChat(
  input: ExtractInput
): Promise<ExtractOutput> {
  ensureGatewayKey();
  const start = Date.now();

  const knownNames = [input.leadName, input.ourName].filter(
    (n): n is string => !!n
  );
  const { anonymized, placeholderMap } = anonymize(input.chatText, knownNames);
  const knowledge = await loadKnowledgeContext();
  const knowledgeBlock = knowledge
    ? `\n\n--- ידע מובנה על המוצר (השתמש בזה כדי לזהות נכון מה הלקוח שואל ומה רלוונטי לו) ---\n\n${knowledge}\n\n--- סוף ידע מובנה ---\n`
    : "";

  let result: ExtractedLead | undefined;
  let error: string | undefined;
  try {
    const { object } = await generateObject({
      model: MODELS.extract,
      schema: ExtractedLeadSchema,
      messages: [
        {
          role: "system",
          content: `אתה מנתח שיחות WhatsApp עבור Weber Tours — נופש כשר באלפים האוסטריים בסנט אנטון. הלקוחות הם יהודים חרדים מישראל, ארה"ב ואירופה.${knowledgeBlock}

תפקידך: לחלץ מידע מובנה משיחה בין "Me" (איש המכירות) לבין הלקוח ("[NAME]").

השיחה מאונונמת: שם הלקוח מופיע כ-[NAME], טלפונים כ-[PHONE_1], אימיילים כ-[EMAIL_1]. הודעות קוליות מתומללות מופיעות כ-[🎤 Voice: "..."].

כללים נוקשים:
1. אל תמציא שום פרט. אם משהו לא נאמר במפורש בשיחה — החזר null או רשימה ריקה.
2. בשדות טקסט חופשי (whatSpokeToThem, objections, summary, suggestedFollowupReason) כתוב בעברית תקנית בלבד, במשפטים קצרים ומדויקים. אל תתרגם מאנגלית בצורה מילולית. אל תשתמש בביטויים שלא נאמרו.
3. בסיכום (summary) הצג 2-3 בולטים — מה הלקוח רוצה, מה הוא חושש ממנו, ומה השלב הבא. אל תוסיף מידע שלא בשיחה.
4. אם הלקוח כתב בשפה זרה (אנגלית/אידיש), עדיין כתוב את הסיכום והתובנות בעברית.
5. עדיפות (priority): "hot" רק אם יש סימן ממשי לרצינות (שאל על מחיר, ביקש פרטים מדויקים, קיבע תאריך). "warm" אם יש עניין כללי. "cold" אם הוא רק שואל מידע ראשוני.
6. סטטוס (status):
   - "new" — בלי תגובה ממך עדיין
   - "contacted" — היה דו-שיח אבל בלי הצעה
   - "interested" — מתעניין באופן פעיל, שואל שאלות
   - "quoted" — קיבל מחיר/הצעה
   - "closing" — מתקדם לסגירה, מבקש לקבוע
   - "booked" — אישר הזמנה
   - "lost" — אמר לא או נעלם
7. תגיות עניין (interestTags): רק כאלו שהוזכרו במפורש. אל תנחש.
8. שפה (language): נסה לזהות מהאופן שהלקוח כותב. אידיש משתמשת באותיות עבריות עם מילים גרמניות ("אונז", "ניט", "פאר", "צו").
9. קהל (audience): רמזים — אמריקאים מזכירים דולרים/לייקווד/ברוקלין; אירופאים מזכירים אנטוורפן/לונדון/יורו עם הקשר אירופאי; ישראלים כותבים בעברית מודרנית עם סלנג ישראלי.

11. **פורמט שדות טקסט**: כתוב בעברית רגילה בלבד, ללא תווי escape כמו "\\n" או "\\t". להפרדה בין בולטים ב-summary, השתמש בתו "•" עם רווח ("• בולט ראשון • בולט שני • בולט שלישי") — בשורה אחת רציפה. אל תכתוב את התווים \\n כטקסט.

10. **המלצת מועד פולואפ (suggestedFollowupHours)** — הכי חשוב:
    - **אם הלקוח אמר מתי לחזור אליו** → השתמש בזה. לדוגמה: "תתקשר אליי ביום שלישי" → חשב כמה שעות מעכשיו עד יום שלישי בבוקר. "אחרי שבת" → מוצאי שבת הקרובה. **תמיד עדיף על ניחוש.**
    - **אם הוא מחכה למשהו ספציפי** (תשובה מהאישה, אישור מטיסה, החלטה משפחתית) → 48-72 שעות. ציין את זה בסיבה.
    - **אם קיבל הצעת מחיר ולא הגיב** → 24 שעות (תזכורת רכה לפני שיתקרר).
    - **אם הוא חם ופעיל בשיחה** (שואל הרבה, מתעניין במחירים, מבקש פרטים) → 12-24 שעות.
    - **אם הוא פושר** (התעניין כללי, לא ביקש שום דבר ספציפי) → 3-5 ימים (72-120 שעות).
    - **אם הוא קר/לא הגיב הרבה זמן** → 7 ימים (168 שעות).
    - **אם הוא נסגר (booked) או אבד (lost)** → null.
    - **אסור** להחזיר זמן בלי סיבה ברורה. תמיד מלא את followupReasoning עם ההיגיון.
    - שעות נמדדות מ**עכשיו** (מהזמן שאתה רץ), לא מההודעה האחרונה.`,
        },
        {
          role: "user",
          content: `הזמן הנוכחי (לחישוב suggestedFollowupHours): ${new Date().toISOString()}\n\n--- שיחת WhatsApp (מאונונמת) ---\n\n${anonymized}`,
        },
      ],
    });
    result = object;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const durationMs = Date.now() - start;
    await db
      .insert(aiAuditLog)
      .values({
        operation: "extract_lead_from_chat",
        model: MODELS.extract,
        inputAnonymized: anonymized,
        output: result ? JSON.stringify(result) : null,
        placeholderMap,
        leadId: input.knownLeadId ?? null,
        durationMs,
        error: error ?? null,
      })
      .catch(() => {});
  }

  // Deanonymize free-text fields and clean up escape-sequence artifacts the
  // model sometimes emits as literal text ("\n", "\t").
  if (result) {
    const clean = (s: string) =>
      deanonymize(s, placeholderMap)
        .replace(/\\r\\n|\\n|\\r/g, "\n")
        .replace(/\\t/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (result.whatSpokeToThem) result.whatSpokeToThem = clean(result.whatSpokeToThem);
    if (result.objections) result.objections = clean(result.objections);
    if (result.summary) result.summary = clean(result.summary);
    if (result.suggestedFollowupReason)
      result.suggestedFollowupReason = clean(result.suggestedFollowupReason);
    if (result.followupReasoning) result.followupReasoning = clean(result.followupReasoning);
  }

  return { lead: result!, durationMs: Date.now() - start };
}
