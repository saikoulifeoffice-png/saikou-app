"use server";
import { revalidatePath } from "next/cache";
import { requireManager, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toAppError, type ActionResult } from "@/lib/errors";

export async function decide(requestId: string, approve: boolean, note: string): Promise<ActionResult> {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_approval_request", { p_request_id: requestId, p_approve: approve, p_note: note });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function withdraw(requestId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_approval_request", { p_request_id: requestId });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/approvals");
  return { ok: true, data: undefined };
}
