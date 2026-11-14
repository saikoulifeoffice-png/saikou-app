"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { purchaseSchema, type PurchaseInput } from "@/lib/validation/purchase";
import { encryptIdentity, decryptIdentity, identityEncryptionConfigured, type IdentityPayload } from "@/lib/crypto/identity";
import { fail, toAppError, type ActionResult } from "@/lib/errors";
import { uuidSchema } from "@/lib/validation/common";
import type { Json } from "@/lib/supabase/database.types";

export interface PurchaseResult {
  purchase_id: string;
  purchase_no: string;
  total_incl: number;
  items: { id: string; item_no: string; line_no: number }[];
  duplicate: boolean;
}

export async function registerPurchase(input: PurchaseInput): Promise<ActionResult<PurchaseResult>> {
  await requireProfile();
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message }, fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  const v = parsed.data;
  let identity: { verification_method: string; encrypted_payload: string; key_version: number } | undefined;
  if (v.identity) {
    if (!identityEncryptionConfigured()) return fail("CONFIG", "本人確認情報の暗号化鍵が未設定のため保存できません（管理者に連絡してください）");
    const { verification_method, ...rest } = v.identity;
    identity = { verification_method, ...encryptIdentity(rest as IdentityPayload) };
  }
  const supabase = await createClient();
  // 担当者IDは DB 側でも検証される（従業員が他人を指定すると拒否）
  const { data, error } = await supabase.rpc("register_purchase", {
    p: {
      idempotency_key: v.idempotency_key,
      purchased_at: v.purchased_at,
      staff_id: v.staff_id ?? null,
      customer_id: v.customer_id ?? null,
      customer_phone: v.customer_phone ?? null,
      customer: v.customer_id ? null : (v.customer ?? null),
      method: v.method,
      payment_method: v.payment_method,
      note: v.note ?? null,
      identity: identity ?? null,
      items: v.items,
      total_incl: v.total_incl,
    } as unknown as Json,
  });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/home");
  revalidatePath("/items");
  revalidatePath("/purchases");
  return { ok: true, data: data as unknown as PurchaseResult };
}

export async function findCustomers(phone: string): Promise<ActionResult<{ id: string; name: string; name_kana: string | null }[]>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_customers_by_phone", { p_phone: phone });
  if (error) return { ok: false, error: toAppError(error) };
  return { ok: true, data: data ?? [] };
}

export async function addItemPhoto(itemId: string, path: string, contentType: string, size: number): Promise<ActionResult<string>> {
  await requireProfile();
  if (!uuidSchema.safeParse(itemId).success) return fail("VALIDATION", "商品IDが不正です");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_item_photo", { p_item_id: itemId, p_path: path, p_content_type: contentType, p_size: size });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath(`/items/${itemId}`);
  return { ok: true, data: data as string };
}

export async function removeItemPhoto(photoId: string, itemId: string): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_item_photo", { p_photo_id: photoId });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath(`/items/${itemId}`);
  return { ok: true, data: undefined };
}

export async function voidOrRequestVoid(purchaseId: string, reason: string, idempotencyKey: string): Promise<ActionResult<{ mode: "voided" | "requested" }>> {
  const profile = await requireProfile();
  if (!reason.trim()) return fail("VALIDATION", "理由を入力してください");
  const supabase = await createClient();
  if (profile.role === "staff") {
    const { error } = await supabase.rpc("create_approval_request", {
      p: { idempotency_key: idempotencyKey, request_type: "purchase_void", target_id: purchaseId, reason },
    });
    if (error) return { ok: false, error: toAppError(error) };
    revalidatePath(`/purchases/${purchaseId}`);
    return { ok: true, data: { mode: "requested" } };
  }
  const { error } = await supabase.rpc("void_purchase", { p_purchase_id: purchaseId, p_reason: reason });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath(`/purchases/${purchaseId}`);
  revalidatePath("/home");
  return { ok: true, data: { mode: "voided" } };
}

export async function revealIdentity(recordId: string, purpose: string): Promise<ActionResult<IdentityPayload & { verification_method: string; retain_until: string }>> {
  await requireProfile();
  if (!purpose.trim()) return fail("VALIDATION", "閲覧目的を入力してください");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_identity_record", { p_record_id: recordId, p_purpose: purpose });
  if (error) return { ok: false, error: toAppError(error) };
  const rec = data?.[0];
  if (!rec) return fail("FORBIDDEN", "この本人確認記録を閲覧する権限がありません（記録されました）");
  try {
    return { ok: true, data: { ...decryptIdentity(rec.encrypted_payload, rec.key_version), verification_method: rec.verification_method, retain_until: rec.retain_until } };
  } catch {
    return fail("DECRYPT", "復号できませんでした（暗号化鍵の設定を確認してください）");
  }
}
