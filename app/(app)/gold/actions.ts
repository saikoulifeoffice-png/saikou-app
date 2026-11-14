"use server";
import { revalidatePath } from "next/cache";
import { requireManager, requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fail, toAppError, type ActionResult } from "@/lib/errors";
import { goldPricesSchema, goldPurchaseSchema, type GoldPricesInput, type GoldPurchaseInput } from "@/lib/validation/gold";
import { uuidSchema } from "@/lib/validation/common";

export interface PriceForDate {
  grade_code: string;
  unit_price: number;
  price_date: string;
  source_name: string;
  fetched_at: string;
  is_exact_date: boolean;
}

export async function getPricesForDate(date: string): Promise<ActionResult<PriceForDate[]>> {
  await requireProfile();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("VALIDATION", "日付が不正です");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pm_prices_for_date", { p_date: date });
  if (error) return { ok: false, error: toAppError(error) };
  return { ok: true, data: (data ?? []).map((r) => ({ ...r, unit_price: Number(r.unit_price) })) };
}

export interface GoldPurchaseResult {
  purchase_id: string;
  purchase_no: string;
  total_metal_value: number;
  expected_profit: number;
  warnings: string[];
  duplicate: boolean;
}

export async function registerGoldPurchase(input: GoldPurchaseInput): Promise<ActionResult<GoldPurchaseResult>> {
  await requireProfile();
  const parsed = goldPurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const v = parsed.data;
  const phone = v.customer_phone?.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－ー]/g, "-").replace(/\s/g, "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pm_register_purchase", { p: { ...v, customer_phone: phone || null } });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/gold");
  return { ok: true, data: data as unknown as GoldPurchaseResult };
}

export async function voidGoldPurchase(id: string, reason: string): Promise<ActionResult> {
  await requireManager();
  if (!uuidSchema.safeParse(id).success) return fail("VALIDATION", "IDが不正です");
  const supabase = await createClient();
  const { error } = await supabase.rpc("pm_void_purchase", { p_id: id, p_reason: reason });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/gold");
  revalidatePath(`/gold/${id}`);
  return { ok: true, data: undefined };
}

export async function saveMarketPrices(input: GoldPricesInput): Promise<ActionResult<number>> {
  await requireManager();
  const parsed = goldPricesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pm_upsert_market_prices", { p: parsed.data });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/gold/prices");
  return { ok: true, data: data as number };
}
