import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/session";
import { ingestWhatsAppArchive } from "@/lib/archive-whatsapp";
import type { Lead } from "@/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 4 * 1024 * 1024;
const VALID_AUDIENCES: Lead["audience"][] = [
  "israeli_haredi",
  "american_haredi",
  "european_haredi",
];
const VALID_LANGUAGES: Lead["language"][] = ["he", "en", "yi"];
const VALID_OUTCOMES = ["booked", "lost"] as const;

/**
 * Single-file WhatsApp archive upload. Synchronous: parse → LLM extract →
 * embed → insert into conversation_archive, all in one request. Bounded by
 * the 5-minute function timeout (typically completes in 15-30s).
 *
 * Why sync rather than the async pending-* pattern: archive uploads are
 * one-off, user is staring at the page, and the result (extracted archetype)
 * is the whole point — there's no review-and-merge step like with leads.
 */
export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const audience = String(form.get("audience") ?? "") as Lead["audience"];
    const language = String(form.get("language") ?? "he") as Lead["language"];
    const outcomeRaw = String(form.get("outcome") ?? "booked");
    const outcome =
      VALID_OUTCOMES.find((o) => o === outcomeRaw) ?? "booked";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "לא הועלה קובץ." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "הקובץ גדול מ-4MB. הסר מדיה גדולה ונסה שוב." },
        { status: 413 }
      );
    }
    if (!VALID_AUDIENCES.includes(audience)) {
      return NextResponse.json(
        { error: "audience לא תקין." },
        { status: 400 }
      );
    }
    if (!VALID_LANGUAGES.includes(language)) {
      return NextResponse.json(
        { error: "language לא תקין." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const isZip =
      file.name.toLowerCase().endsWith(".zip") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

    const result = await ingestWhatsAppArchive({
      fileBytes: bytes,
      isZip,
      originalFilename: file.name,
      audience,
      language,
      knownOutcome: outcome,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      archiveId: result.archiveId,
      conversationCount: result.conversationCount,
      scrubStats: result.scrubStats,
      outcome: result.outcome,
      outcomeConfidence: result.outcomeConfidence,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[archive/whatsapp] upload failed", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
