import { NextResponse, after } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { del } from "@vercel/blob";
import { createHash } from "node:crypto";
import { db, pendingWhatsAppImports } from "@/db";
import { eq } from "drizzle-orm";
import { getSetting } from "@/lib/settings";
import { processOne } from "@/lib/whatsapp-import-worker";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BYTES = 100 * 1024 * 1024;

interface ClientPayload {
  language?: "he" | "en" | "yi" | null;
  filename?: string;
}

/**
 * Two-phase client upload via @vercel/blob:
 *
 *   1. Client calls `upload()` from @vercel/blob/client.
 *   2. That helper POSTs here with `type: "blob.generate-client-token"`.
 *      We validate the user is set up (has a whatsapp display name),
 *      restrict content type & size, and pass back a token.
 *   3. Client uploads bytes DIRECTLY to Vercel Blob — bypassing the
 *      4.5MB function body limit that broke the old form-data flow.
 *   4. After upload completes, this same route is called again with
 *      `type: "blob.upload-completed"`. We download the bytes from
 *      Blob (no body limit on outbound fetches), insert the pending
 *      row, queue the worker, and delete the blob.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      "[whatsapp-import/upload] BLOB_READ_WRITE_TOKEN not set — enable Vercel Blob in the project's Storage tab and redeploy."
    );
    return NextResponse.json(
      {
        error:
          "אחסון ה-Blob לא מופעל בפרויקט. ב-Vercel Dashboard → Storage → Create Database → Blob, ואז Redeploy.",
      },
      { status: 500 }
    );
  }

  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const myName = await getSetting("whatsapp_display_name");
        if (!myName) {
          throw new Error(
            "קודם הגדר את השם שלך בוואטסאפ בעמוד ההגדרות (כך נדע מה אתה שלחת ומה הלקוח)."
          );
        }
        return {
          allowedContentTypes: [
            "application/zip",
            "application/x-zip-compressed",
            "text/plain",
            "application/octet-stream",
          ],
          maximumSizeInBytes: MAX_BYTES,
          tokenPayload: clientPayload ?? "",
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Runs on Vercel side AFTER the client finishes uploading. Errors
        // here don't reach the user — they only show up in server logs —
        // so we have to be defensive: any failure leaves the row in a
        // queryable state (or deletes the blob to avoid leaking storage).
        try {
          const payload = (
            tokenPayload ? (JSON.parse(tokenPayload) as ClientPayload) : {}
          ) as ClientPayload;

          const res = await fetch(blob.url);
          if (!res.ok) {
            throw new Error(`Failed to fetch blob: ${res.status}`);
          }
          const bytes = Buffer.from(await res.arrayBuffer());
          const contentHash = createHash("sha256").update(bytes).digest("hex");

          const filename =
            payload.filename ?? blob.pathname.split("/").pop() ?? "whatsapp.zip";
          const isZip =
            filename.toLowerCase().endsWith(".zip") ||
            blob.contentType === "application/zip" ||
            blob.contentType === "application/x-zip-compressed";

          const [existing] = await db
            .select({ id: pendingWhatsAppImports.id })
            .from(pendingWhatsAppImports)
            .where(eq(pendingWhatsAppImports.contentHash, contentHash));

          let id = existing?.id;
          if (!id) {
            const [inserted] = await db
              .insert(pendingWhatsAppImports)
              .values({
                contentHash,
                originalFilename: filename,
                fileBytes: bytes,
                isZip,
                language: payload.language ?? null,
              })
              .onConflictDoNothing({
                target: pendingWhatsAppImports.contentHash,
              })
              .returning({ id: pendingWhatsAppImports.id });
            id = inserted?.id;
            if (!id) {
              const [row] = await db
                .select({ id: pendingWhatsAppImports.id })
                .from(pendingWhatsAppImports)
                .where(eq(pendingWhatsAppImports.contentHash, contentHash));
              id = row?.id;
            }
          }

          if (id) {
            const finalId = id;
            after(async () => {
              try {
                await processOne({ id: finalId });
              } catch (e) {
                console.error(
                  "[whatsapp-import] background worker crashed",
                  finalId,
                  e
                );
              }
            });
          }
        } catch (e) {
          console.error("[whatsapp-import] onUploadCompleted failed", e);
        } finally {
          // Always delete the blob — we have the bytes in the DB now (or
          // we failed and there's nothing to recover). Leaving blobs
          // around just costs storage.
          try {
            await del(blob.url);
          } catch (e) {
            console.error("[whatsapp-import] blob delete failed", blob.url, e);
          }
        }
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
    console.error("[whatsapp-import/upload] handleUpload failed", e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
