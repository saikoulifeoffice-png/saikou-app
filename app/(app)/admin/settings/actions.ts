"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toAppError, type ActionResult } from "@/lib/errors";

const schema = z.object({
  tax_basis: z.enum(["incl", "excl"]),
  tax_rounding: z.enum(["floor", "round", "ceil"]),
  staff_can_view_other_inventory: z.boolean(),
  admin_can_approve_funds: z.boolean(),
  identity_retention_years: z.number().int().min(1).max(30),
  long_stay_days: z.number().int().min(1).max(3650),
  ui_mode: z.enum(["simple", "full"]),
  pm_price_source_name: z.string().trim().min(1, "相場の取得元名を入力してください").max(100),
});

export async function saveSettings(input: z.input<typeof schema>): Promise<ActionResult> {
  await requireOwner();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_settings", { p: parsed.data });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
