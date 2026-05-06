import { generateObject } from "ai";
import { z } from "zod";
import { MODELS } from "./ai-client";
import { embedOne } from "./embeddings";
import { scrubArchiveText } from "./archive-scrubber";
import { anonymize } from "./anonymize";
import type { Lead } from "@/db";

/**
 * Hybrid extraction shape. Structured fields below are the ones the chat will
 * retrieve explicitly during draft generation; `freeFormInsights` catches
 * anything noteworthy that didn't fit the schema. Both contribute to the
 * row's embedding so cosine retrieval can find the conversation through
 * either path.
 */
const ArchetypeSchema = z.object({
  persona: z.object({
    community: z
      .string()
      .nullable()
      .describe(
        "קהילה אם זוהתה בבירור: 'belz', 'ger', 'satmar', 'chabad', 'modern_orthodox', 'litvish', 'mixed'. null אם לא ברור."
      ),
    religiosity: z
      .enum(["haredi", "haredi_modern", "modern_orthodox", "traditional", "unclear"])
      .describe("רמת הקפדה דתית כללית."),
    decisionMakers: z
      .array(z.string())
      .describe(
        "מי מעורב בקבלת ההחלטה: ['self'], ['self','spouse'], ['self','rabbi'], ['mother'], וכו'."
      ),
    familySizeRange: z
      .enum(["couple", "small_family_1_3", "medium_family_4_6", "large_family_7_plus", "group", "unclear"])
      .describe("גודל הקבוצה הנוסעת."),
    notes: z
      .string()
      .nullable()
      .describe("הערה קצרה (משפט אחד) על מה שייחד את הלקוח הזה. null אם אין משהו ייחודי."),
  }),
  interestDrivers: z
    .array(z.string())
    .describe(
      "מה משך אותם — מנייה של 2-6 תגיות snake_case באנגלית. דוגמאות: 'kashrut_strictness', 'rabbi_lectures', 'kids_activities', 'separate_dining', 'walk_to_minyan', 'short_flight', 'first_time_in_alps'."
    ),
  objections: z
    .array(z.string())
    .describe(
      "התנגדויות שעלו, snake_case באנגלית. דוגמאות: 'distance_to_minyan', 'food_strictness_concern', 'language_barrier', 'kids_entertainment', 'previous_bad_experience'. ריק אם לא היו."
    ),
  winningAngle: z
    .string()
    .nullable()
    .describe(
      "המשפט שהכריע — מה שגרם לפריצת דרך בשיחה. רק אם השיחה נסגרה בהצלחה (booked). אחרת null. דוגמה: 'הזכרתי שהרב אונגר מגיע ושיש מטבח כשר עם משגיח קבוע — מיד שאלו על תאריכים'."
    ),
  followUpCadence: z
    .object({
      daysAfterSilence: z
        .number()
        .nullable()
        .describe(
          "כמה ימים שתק הלקוח לפני שאיציק עשה פאלו אפ שהחזיר אותו לשיחה. null אם לא היה פאלו אפ או שלא חזר."
        ),
      channel: z
        .enum(["whatsapp", "phone", "email", "unknown"])
        .describe("ערוץ הפאלו אפ שעבד."),
      trigger: z
        .string()
        .nullable()
        .describe("מה הצית את חזרת הלקוח לשיחה (במשפט אחד)."),
    })
    .describe("דפוס הפאלו אפ שעבד עבור הלקוח הזה. null שדות אם לא רלוונטי."),
  freeFormInsights: z
    .string()
    .describe(
      "כל מה שעלה לך מהשיחה ולא נכנס לשדות למעלה ועלול לעזור בלידים עתידיים דומים. 2-5 משפטים. בעברית."
    ),
});

const OutcomeSchema = z.object({
  outcome: z.enum(["booked", "lost", "unknown"]),
  outcomeConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "כמה ברור התוצאה מהתמליל. 1.0 = הלקוח אמר במפורש 'סוגרים' או 'מבטל'. 0.6-0.9 = ברור מההקשר. < 0.6 = ניחוש על סמך טון."
    ),
  outcomeReason: z.string().describe("משפט קצר — איך זוהתה התוצאה."),
});

export const ExtractionResultSchema = z.object({
  archetype: ArchetypeSchema,
  inferredOutcome: OutcomeSchema.nullable().describe(
    "הסקה אוטומטית של תוצאה מהתמליל. null אם השולח כבר סיפק outcome ידוע (למשל, ייצוא וואטסאפ של 'רק שיחות שסגרתי')."
  ),
});

export type Archetype = z.infer<typeof ArchetypeSchema>;
export type InferredOutcome = z.infer<typeof OutcomeSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

const SYSTEM_PROMPT = `אתה מנתח שיחות מכירה היסטוריות של איציק (Weber Tours — חופשות כשרות באלפים האוסטריים, סנט אנטון).

תפקידך: לחלץ מהשיחה ארכיטיפ של הלקוח כדי שלידים דומים בעתיד יקבלו תשובה חכמה יותר. **אינך** לומד מחירים או תאריכים מוחלטים — אלה מוסרו מראש מהתמליל והוחלפו ב-<מחיר> / <תאריך> / <שעה>. תתעלם מהאסימונים האלה.

עקרונות חשובים:

1. **הפרסונה היא הליבה.** קהילה, מצב משפחתי, גורם החלטה — אלה המשתנים שצריכים להיות מדויקים. אם לא ברור — סמן unclear/null. אל תנחש.

2. **interest_drivers** = מה גרם להם להמשיך לדבר. השלבים המוקדמים של השיחה מדברים — שאלות ראשונות של הלקוח.

3. **objections** = מה עצר אותם או דרש שכנוע. גם אם בסוף סגרו.

4. **winning_angle** = רק לשיחות שסגרו (booked). מה היה הרגע שבו הטון השתנה? איזה משפט של איציק הוביל ללקוח לשאול שאלות סוגרות (תאריכים זמינים, איך משלמים, וכו')?

5. **follow_up_cadence** = אם הלקוח שתק והוחזר — כמה ימים, באיזה ערוץ, ומה הציל אותו. אם השיחה זרמה רציף — null.

6. **free_form_insights** = הזדמנות שלך להוסיף הבנה שלא בסכמה. דוגמאות:
   - "לקוחות מסוג זה נוטים לדחות החלטה עד שמדברים עם הרב — שווה להציע פנייה ישירה"
   - "ההתנגדות שלהם הופיעה אחרי שהוצג מסלול — אולי כדאי להציג מסלול מאוחר יותר"

7. **inferred outcome** = רק אם **לא** נאמר לך מראש. אם הלקוח לא מסר תוצאה ברורה — דרגת ביטחון נמוכה.

חשוב: בכל הפלט הטקסטואלי בעברית (חוץ מתגיות snake_case לפי הסכמה).`;

export interface ExtractArgs {
  rawTranscript: string;
  audience: Lead["audience"];
  language: Lead["language"];
  knownNames?: string[];
  /**
   * If the source already labeled the outcome (e.g. "WhatsApp export of only
   * closed deals"), pass it here. The extractor will skip outcome inference
   * to save tokens and avoid the model overwriting a known label.
   */
  knownOutcome?: "booked" | "lost";
}

export interface ExtractedConversation {
  archetype: Archetype;
  outcome: "booked" | "lost" | "unknown";
  outcomeConfidence: number;
  outcomeReason: string | null;
  scrubbedTranscript: string;
  embedding: number[] | null;
  scrubStats: {
    removedPrices: number;
    removedDates: number;
    removedTimes: number;
  };
}

/**
 * Builds the embedding input for an archived conversation. We embed
 * `winning_angle + persona summary + interest_drivers + objections` rather
 * than the full transcript so cosine retrieval at draft time scopes to "what
 * about this lead's archetype lights up similar past conversations".
 */
function buildArchiveEmbeddingInput(arch: Archetype): string {
  const parts = [
    arch.winningAngle,
    `community=${arch.persona.community ?? "unclear"}`,
    `religiosity=${arch.persona.religiosity}`,
    `family=${arch.persona.familySizeRange}`,
    `interests: ${arch.interestDrivers.join(", ")}`,
    arch.objections.length > 0 ? `objections: ${arch.objections.join(", ")}` : null,
    arch.persona.notes,
  ].filter(Boolean);
  return parts.join(" | ");
}

export async function extractArchivedConversation(
  args: ExtractArgs
): Promise<ExtractedConversation> {
  const scrubbed = scrubArchiveText(args.rawTranscript);
  const { anonymized } = anonymize(scrubbed.text, args.knownNames ?? []);

  const userMessage = [
    `קהל: ${args.audience}`,
    `שפה: ${args.language}`,
    args.knownOutcome
      ? `תוצאה ידועה (אל תסיק שוב): ${args.knownOutcome}`
      : "תוצאה: אינה ידועה — הסיק מהתמליל אם אפשר.",
    "",
    "--- תמליל ---",
    anonymized,
  ].join("\n");

  const { object } = await generateObject({
    model: MODELS.learning,
    schema: ExtractionResultSchema,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  const outcome = args.knownOutcome ?? object.inferredOutcome?.outcome ?? "unknown";
  const outcomeConfidence = args.knownOutcome
    ? 1
    : (object.inferredOutcome?.outcomeConfidence ?? 0);
  const outcomeReason = args.knownOutcome
    ? "supplied by importer"
    : (object.inferredOutcome?.outcomeReason ?? null);

  let embedding: number[] | null = null;
  try {
    embedding = await embedOne(buildArchiveEmbeddingInput(object.archetype));
  } catch {
    embedding = null;
  }

  return {
    archetype: object.archetype,
    outcome,
    outcomeConfidence,
    outcomeReason,
    scrubbedTranscript: anonymized,
    embedding,
    scrubStats: {
      removedPrices: scrubbed.removedPrices,
      removedDates: scrubbed.removedDates,
      removedTimes: scrubbed.removedTimes,
    },
  };
}
