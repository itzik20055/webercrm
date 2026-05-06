import { config } from "dotenv";
config({ path: ".env.local" });
import { extractArchivedConversation } from "../lib/archive-extractor";

async function main() {
  // Same musician transcript that hit the prod error — names should be
  // [NAME] / [NAME_2] etc, not "תור סגל".
  const transcript = `=== שיחה 1 — יום 1 ===
מוכר: ובר טורס שלום.
לקוח: שלום, מדבר פה תור סגל, נגן מנדולינה. אה רציתי להציע את...
מוכר: תור סגל נגן מנדולינה?
לקוח: כן. רציתי להציע את שירותיי, יש לי מופע שאני רץ איתו כבר כל השנה.
מוכר: הגעת למכירות, ואני לא אה בא לי, אם תגיד לי מה המספר שלך, אני אעביר את זה הלאה.
לקוח: אז אני אשמח, תודה רבה. תור פה, ביי.
מוכר: יום טוב.`;

  console.log("--- raw input ---");
  console.log(transcript);
  console.log("\n\n--- extracting (NER + scrub + anonymize + LLM) ---\n");

  const result = await extractArchivedConversation({
    rawTranscript: transcript,
    audience: "israeli_haredi",
    language: "he",
    knownNames: [],
  });

  console.log("scrubStats:", result.scrubStats);
  console.log("outcome:", result.outcome, "conf:", result.outcomeConfidence);
  console.log("outcomeReason:", result.outcomeReason);
  console.log("\nscrubbedTranscript (what got persisted):");
  console.log(result.scrubbedTranscript);
  console.log("\narchetype:");
  console.log(JSON.stringify(result.archetype, null, 2));

  // Sanity check
  const hasName = result.scrubbedTranscript.includes("תור סגל") ||
    result.scrubbedTranscript.includes("תור ");
  console.log(`\n✓ Names anonymized? ${!hasName ? "YES" : "❌ NO — leak detected"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
