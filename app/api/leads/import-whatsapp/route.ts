import { NextResponse, after } from "next/server";
import { createHash } from "node:crypto";
import { db, pendingWhatsAppImports } from "@/db";
import { eq } from "drizzle-orm";
import { getSetting } from "@/lib/settings";
import { processOne } from "@/lib/whatsapp-import-worker";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Direct FormData upload for small files (<4MB after client-side strip).
 * Vercel's per-request body limit on Pro is ~4.5MB so we cap here at 4MB to
 * leave headroom for multipart overhead. Anything bigger goes through the
 * /upload sibling route which uses Vercel Blob.
 */
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
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

    const form = await req.formData();
    const file = form.get("file");
    const language = (form.get("language") as "he" | "en" | "yi" | null) ?? null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "לא הועלה קובץ." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error:
            "הקובץ גדול לזרימה הישירה — השתמש בנתיב Blob (/api/leads/import-whatsapp/upload).",
        },
        { status: 413 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const isZip =
      file.name.toLowerCase().endsWith(".zip") ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

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

    const finalId = id;
    after(async () => {
      try {
        await processOne({ id: finalId });
      } catch (e) {
        console.error("[whatsapp-import] background worker crashed", finalId, e);
      }
    });

    return NextResponse.json(
      { ok: true, id, status: "pending", duplicate: false },
      { status: 202 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[whatsapp-import] enqueue failed", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
