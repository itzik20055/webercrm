"use server";

import { revalidatePath } from "next/cache";
import { isAuthenticated } from "@/lib/session";
import {
  countPendingCallRecordings,
  resetProcessedUids,
} from "@/lib/gmail-imap";
import {
  runCallRecordingsPull,
  type PullResult,
} from "@/lib/call-recordings-runner";

async function guard() {
  if (!(await isAuthenticated())) {
    throw new Error("Unauthorized");
  }
}

export async function getCallRecordingsStatus(): Promise<
  | { ok: true; total: number; pending: number }
  | { ok: false; error: string }
> {
  try {
    await guard();
    const { total, pending } = await countPendingCallRecordings();
    return { ok: true, total, pending };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function pullCallRecordingsNow(): Promise<PullResult> {
  await guard();
  const result = await runCallRecordingsPull({ limit: 2 });
  revalidatePath("/inbox");
  revalidatePath("/settings");
  revalidatePath("/");
  return result;
}

export async function resetCallRecordingsHistory(): Promise<{ ok: true }> {
  await guard();
  await resetProcessedUids();
  revalidatePath("/settings");
  return { ok: true };
}
