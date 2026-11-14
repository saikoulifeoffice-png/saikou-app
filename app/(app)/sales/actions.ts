"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fail, toAppError, type ActionResult } from "@/lib/errors";
import { paymentSchema, returnSchema, saleSchema, type SaleInput } from "@/lib/validation/sale";

export interface SellableItem {
  id: string;
  item_no: string;
  name: string;
  brand: string | null;
  stock_quantity: number;
  stock_cost: number | null;
  staff_name: string;
  is_mine: boolean;
  category_name: string;
}

export async function searchSellable(q: string): Promise<ActionResult<SellableItem[]>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_items", { p_q: q.slice(0, 100) || undefined, p_status: "in_stock", p_scope: "all", p_limit: 30, p_offset: 0 });
  if (error) return { ok: false, error: toAppError(error) };
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id, item_no: r.item_no, name: r.name, brand: r.brand, stock_quantity: r.stock_quantity,
      stock_cost: r.stock_cost, staff_name: r.staff_name, is_mine: r.is_mine, category_name: r.category_name,
    })),
  };
}

function revalidateSales(id?: string) {
  revalidatePath("/sales");
  revalidatePath("/home");
  revalidatePath("/items");
  if (id) revalidatePath(`/sales/${id}`);
}

export async function registerSale(input: SaleInput): Promise<ActionResult<{ sale_id: string; sale_no: string; duplicate: boolean }>> {
  await requireProfile();
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_sale", { p: parsed.data });
  if (error) return { ok: false, error: toAppError(error) };
  const r = data as unknown as { sale_id: string; sale_no: string; duplicate: boolean };
  revalidateSales(r.sale_id);
  return { ok: true, data: r };
}

export async function recordPayment(input: z.input<typeof paymentSchema>): Promise<ActionResult> {
  await requireProfile();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", { p: parsed.data });
  if (error) return { ok: false, error: toAppError(error) };
  revalidateSales(parsed.data.sale_id);
  return { ok: true, data: undefined };
}

export async function registerReturn(input: z.input<typeof returnSchema>): Promise<ActionResult<{ sale_id: string }>> {
  await requireProfile();
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_return", { p: parsed.data });
  if (error) return { ok: false, error: toAppError(error) };
  revalidateSales(parsed.data.original_sale_id);
  return { ok: true, data: data as unknown as { sale_id: string } };
}

export async function cancelOrRequestCancel(saleId: string, reason: string, key: string): Promise<ActionResult<{ mode: "cancelled" | "requested" }>> {
  const me = await requireProfile();
  if (!reason.trim()) return fail("VALIDATION", "理由を入力してください");
  const supabase = await createClient();
  if (me.role === "staff") {
    const { error } = await supabase.rpc("create_approval_request", { p: { idempotency_key: key, request_type: "sale_cancel", target_id: saleId, reason } });
    if (error) return { ok: false, error: toAppError(error) };
    revalidateSales(saleId);
    return { ok: true, data: { mode: "requested" } };
  }
  const { error } = await supabase.rpc("cancel_sale", { p_sale_id: saleId, p_reason: reason });
  if (error) return { ok: false, error: toAppError(error) };
  revalidateSales(saleId);
  return { ok: true, data: { mode: "cancelled" } };
}
