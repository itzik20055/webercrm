/**
 * One-shot end-to-end smoke test for the archive ingestion pipeline. Creates
 * a synthetic Hebrew WhatsApp transcript that includes prices, calendar
 * dates, and prayer times — runs it through the same path the real
 * /api/archive/whatsapp endpoint uses, then prints what came out at each
 * stage so we can eyeball the scrubber, the extractor, and the embedding.
 *
 * Run with: npx tsx scripts/test-archive-import.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { ingestWhatsAppArchive } from "../lib/archive-whatsapp";

const SAMPLE_CONVERSATION = `[12/01/2025, 09:42:15] משה כהן: שלום איציק, שמעתי עלייך מהרב שלי, אנחנו חושבים על נופש פסח עם המשפחה
[12/01/2025, 09:42:33] איציק וובר: שלום וברוך הבא, נעים מאוד. תספר לי קצת — כמה אנשים בקבוצה?
[12/01/2025, 09:43:01] משה כהן: אני, אשתי, ו-5 ילדים. הגדול בן 14 הקטן בן 3
[12/01/2025, 09:43:48] איציק וובר: יפה, משפחה גדולה ב"ה. השאלה הראשונה שלי תמיד — מי הרב הפוסק שלכם? אני שואל כי יש שלוש רמות כשרות במלון, ורוצה לוודא שמה שאתחיל לדבר איתך מתאים בדיוק
[12/01/2025, 09:45:12] משה כהן: אנחנו בעלזער ירושלים, הרב שלנו אמר שכל מה שיש לך מספיק טוב
[12/01/2025, 09:45:40] איציק וובר: נכון, יש לנו השגחה רגילה ויש מטבח מהדרין נפרד עם משגיח קבוע מבעלז שמגיע איתנו לסנט אנטון. תרגיש בבית
[12/01/2025, 09:46:20] משה כהן: יופי. מה לגבי תפילות? יש מנייני שחרית?
[12/01/2025, 09:47:05] איציק וובר: 3 מנייני שחרית, השכמה ב-6:45, רגיל ב-8:00, ומאוחר ב-9:30. בית הכנסת בתוך המלון, בנייה צמוד לחדרים
[12/01/2025, 09:48:40] משה כהן: ובאמת תהיה הרצאה של הרב אונגר השנה?
[12/01/2025, 09:49:18] איציק וובר: כן, מאשרים השבוע. הוא יגיע מהיום הראשון עד הרביעי של פסח. גם הרב אליעזר שטפנסקי יהיה כל החג
[12/01/2025, 09:50:02] משה כהן: וואו, זה נשמע מצוין. ומה לגבי המחיר? ב-5 ילדים זה יוצא יקר?
[12/01/2025, 09:51:33] איציק וובר: בנייה משפחתית 3 חדרים מתואמים יוצאת 18,500 ש"ח לכל החג, כולל כל הארוחות ואירועי ילדים. אם הקטנים בחדר איתכם זה יורד ל-15,000 ש"ח
[12/01/2025, 09:53:18] משה כהן: זה הרבה. אבדוק עם אשתי ואחזור אליך
[12/01/2025, 09:53:42] איציק וובר: בוודאי. תזכור — אנחנו פותחים פסח השנה ב-13.4 ויש לנו עכשיו רק 4 חדרים משפחתיים פנויים. אל תתעכב יותר משבוע אם אתם רוצים בנייה קרובה לבית הכנסת
[19/01/2025, 14:20:00] איציק וובר: הי משה, רציתי לעדכן — הצלחנו לשחרר עוד חדר משפחתי בקומה 2, צמוד לבית הכנסת. אם זה רלוונטי, אשמור לכם
[19/01/2025, 14:35:11] משה כהן: היי, סליחה שלא חזרתי. דיברנו עם הרב והוא ממליץ. נסגור?
[19/01/2025, 14:36:02] איציק וובר: יפה מאוד. אני שולח לך עכשיו פרטי תשלום — מקדמה 5,000 שח לתפיסת המקום, השאר 30 יום לפני
[19/01/2025, 14:36:44] משה כהן: מצוין, מעביר עכשיו
[19/01/2025, 14:55:10] משה כהן: שלחתי. סגור!
[19/01/2025, 14:55:32] איציק וובר: קיבלתי, מאשר! נתראה בסנט אנטון. שבוע טוב
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY missing");

  // Make sure whatsapp_display_name is set — the parser uses it to label
  // איציק's messages vs the customer's. If absent we set a dev-only value.
  const sql = neon(url);
  const db = drizzle(sql, { schema, casing: "snake_case" });
  const [setting] = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "whatsapp_display_name"));
  if (!setting?.value) {
    console.log("seeding whatsapp_display_name = 'איציק וובר' for the test");
    await db
      .insert(schema.appSettings)
      .values({
        key: "whatsapp_display_name",
        value: "איציק וובר",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: "איציק וובר", updatedAt: new Date() },
      });
  } else {
    console.log(`whatsapp_display_name already set: ${setting.value}`);
  }

  const bytes = Buffer.from(SAMPLE_CONVERSATION, "utf8");

  console.log("\n--- ingesting synthetic WhatsApp conversation ---\n");
  const result = await ingestWhatsAppArchive({
    fileBytes: bytes,
    isZip: false,
    originalFilename: "test-belzer-pesach-2025-v2.txt",
    audience: "israeli_haredi",
    language: "he",
    knownOutcome: "booked",
  });

  if (!result.ok) {
    console.error("INGEST FAILED:", result.error);
    process.exit(1);
  }

  console.log("✓ archive id:", result.archiveId);
  console.log("✓ message count:", result.conversationCount);
  console.log("✓ scrub stats:", result.scrubStats);
  console.log("✓ outcome:", result.outcome, "(confidence:", result.outcomeConfidence + ")");

  // Pull the saved row so we can show what actually got into the DB.
  const [saved] = await db
    .select()
    .from(schema.conversationArchive)
    .where(eq(schema.conversationArchive.id, result.archiveId!));

  console.log("\n--- archetype extracted ---\n");
  console.log(JSON.stringify(saved.archetype, null, 2));

  console.log("\n--- embedding present? ---");
  console.log(
    saved.embedding ? `yes (${saved.embedding.length} dims)` : "no — embedding failed"
  );

  console.log("\n✓ end-to-end smoke test passed. archive id stays in DB for retrieval testing.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
