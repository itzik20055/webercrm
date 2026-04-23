"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/session";
import { runEmailSync, type SyncResult } from "@/lib/email-sync-worker";
import { processEmailImport } from "@/lib/email-import-worker";

async function guard() {
  if (!(await isAuthenticated())) {
    throw new Error("Unauthorized");
  }
}

export interface ManualSyncResult {
  ok: true;
  sync: SyncResult;
  importsDrained: number;
}

/**
 * Manual "sync now" trigger — same work the 4-hour cron does, on demand.
 * Drains any queued new_import rows first (up to 3 to cap time) then runs
 * the watched-address sync.
 */
export async function runEmailSyncNow(): Promise<ManualSyncResult> {
  await guard();
  let importsDrained = 0;
  for (let i = 0; i < 3; i++) {
    const r = await processEmailImport();
    if (r.status === "no_work") break;
    importsDrained += 1;
  }
  const sync = await runEmailSync();
  revalidatePath("/inbox");
  revalidatePath("/queue");
  revalidatePath("/");
  return { ok: true, sync, importsDrained };
}
