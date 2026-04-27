import { NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { db, pendingWhatsAppImports } from "@/db";
import { eq } from "drizzle-orm";
import { getSetting } from "@/lib/settings";
import { processOne } from "@/lib/whatsapp-import-worker";

export const runtime = "nodejs";
// Keep the function alive long enough for the background worker to finish
// (typical WA chat with ~20 voice notes is 30-90s). If the function exits
// sooner the cron safety net will pick the row up within 1 minute.
export const maxDuration = 300;

const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  const t0 = Date.now();
  console.log("[whatsapp-import] POST received", {
    contentType: req.headers.get("content-type"),
    contentLength: req.headers.get("content-length"),
  });

  try {
    const myName = await getSetting("whatsapp_display_name");
    if (!myName) {
      return NextResponse.json(
        {
          error:
            "קודם הגדר את השם שלך בוואטסאפ בעמוד ההגדרות (כך נדע מה אתה שלחת ומה הלקוח).",
        },
        { status: 400 }
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      console.error("[whatsapp-import] formData() parse failed", e);
      return NextResponse.json(
        {
          error: `לא הצלחתי לקרוא את הטופס: ${e instanceof Error ? e.message : String(e)}`,
        },
        { status: 400 }
      );
    }

    const file = form.get("file");
    const language = (form.get("language") as "he" | "en" | "yi" | null) ?? null;

    if (!(file instanceof File)) {
      console.error("[whatsapp-import] no file in form", { fileType: typeof file });
      return NextResponse.json({ error: "לא הועלה קובץ." }, { status: 400 });
    }
    console.log("[whatsapp-import] file received", {
      name: file.name,
      size: file.size,
      type: file.type,
      language,
    });
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "הקובץ גדול מדי (מקסימום 100MB). ייצא שוב מוואטסאפ ללא מדיה, או מחק הודעות קוליות ישנות מהצ'אט." },
        { status: 413 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    console.log("[whatsapp-import] hashed", {
      bytes: bytes.length,
      contentHash: contentHash.slice(0, 12),
      elapsedMs: Date.now() - t0,
    });
    const isZip =
      file.name.toLowerCase().endsWith(".zip") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

    // Idempotency: if the exact same file was uploaded before we reuse that
    // row rather than burning tokens on a duplicate. UNIQUE index on
    // content_hash enforces this even if two uploads race.
    const [existing] = await db
      .select({
        id: pendingWhatsAppImports.id,
        status: pendingWhatsAppImports.status,
      })
      .from(pendingWhatsAppImports)
      .where(eq(pendingWhatsAppImports.contentHash, contentHash));

    if (existing) {
      return NextResponse.json({
        ok: true,
        id: existing.id,
        status: existing.status,
        duplicate: true,
      });
    }

    const [inserted] = await db
      .insert(pendingWhatsAppImports)
      .values({
        contentHash,
        originalFilename: file.name,
        fileBytes: bytes,
        isZip,
        language,
      })
      .onConflictDoNothing({ target: pendingWhatsAppImports.contentHash })
      .returning({ id: pendingWhatsAppImports.id });

    // If onConflictDoNothing skipped (another concurrent upload won), look up
    // the winning row and return it.
    let id = inserted?.id;
    if (!id) {
      const [row] = await db
        .select({ id: pendingWhatsAppImports.id })
        .from(pendingWhatsAppImports)
        .where(eq(pendingWhatsAppImports.contentHash, contentHash));
      id = row?.id;
    }
    if (!id) {
      throw new Error("לא הצלחנו לרשום את הייבוא. נסה שוב.");
    }

    // Fire-and-forget the worker — processing kicks off immediately so the
    // user sees the card ready in the inbox within seconds/a minute. If the
    // serverless function dies before the worker finishes, the cron safety
    // net picks it up within 1 min.
    const finalId = id;
    after(async () => {
      try {
        await processOne({ id: finalId });
      } catch (e) {
        console.error("[whatsapp-import] background worker crashed", finalId, e);
      }
    });

    console.log("[whatsapp-import] enqueued", {
      id,
      totalElapsedMs: Date.now() - t0,
    });
    return NextResponse.json(
      { ok: true, id, status: "pending", duplicate: false },
      { status: 202 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[whatsapp-import] enqueue failed", {
      error: e,
      message,
      elapsedMs: Date.now() - t0,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
