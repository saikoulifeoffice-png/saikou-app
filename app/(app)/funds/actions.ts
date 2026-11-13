"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fail, toAppError, type ActionResult } from "@/lib/errors";
import { optionalText, positiveYen, uuidSchema, yen } from "@/lib/validation/common";

const opSchema = z.object({
  idempotency_key: uuidSchema,
  type: z.enum(["opening", "replenish", "return_to_company", "transfer"]),
  account_id: uuidSchema,
  counterpart_account_id: uuidSchema.optional(),
  amount: positiveYen(),
  memo: optionalText(500),
});

export async function fundOperation(input: z.input<typeof opSchema>): Promise<ActionResult> {
  await requireProfile();
  const parsed = opSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fund_operation", { p: parsed.data });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/funds");
  revalidatePath("/home");
  return { ok: true, data: undefined };
}

const reqSchema = z.object({
  idempotency_key: uuidSchema,
  request_type: z.enum(["fund_replenish", "fund_transfer", "fund_adjustment"]),
  target_id: uuidSchema.optional(),
  amount: z.number().int().refine((v) => v !== 0, "金額を入力してください"),
  to_profile_id: uuidSchema.optional(),
  reconciliation_id: uuidSchema.optional(),
  reason: z.string().trim().min(1, "理由を入力してください").max(1000),
});

export async function createFundRequest(input: z.input<typeof reqSchema>): Promise<ActionResult> {
  await requireProfile();
  const parsed = reqSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const v = parsed.data;
  if (v.request_type !== "fund_adjustment" && v.amount < 0) return fail("VALIDATION", "金額は1円以上で入力してください");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_approval_request", {
    p: {
      idempotency_key: v.idempotency_key,
      request_type: v.request_type,
      target_id: v.target_id ?? null,
      reason: v.reason,
      payload: { amount: v.amount, to_profile_id: v.to_profile_id ?? null, reconciliation_id: v.reconciliation_id ?? null },
    },
  });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/funds");
  revalidatePath("/approvals");
  return { ok: true, data: undefined };
}

const reconSchema = z.object({ account_id: uuidSchema, counted_amount: yen("実査額"), note: optionalText(1000) });

export async function recordReconciliation(input: z.input<typeof reconSchema>): Promise<ActionResult<{ reconciliation_id: string; ledger_balance: number; difference: number }>> {
  await requireProfile();
  const parsed = reconSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_reconciliation", {
    p_account_id: parsed.data.account_id, p_counted_amount: parsed.data.counted_amount, p_note: parsed.data.note ?? "",
  });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/funds");
  return { ok: true, data: data as unknown as { reconciliation_id: string; ledger_balance: number; difference: number } };
}
