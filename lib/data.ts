import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/session";

export async function getCategories() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("item_categories").select("id, name").eq("is_active", true).order("sort_order");
  if (error) throw error;
  return data;
}

export async function getFundBalances() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fund_balances");
  if (error) throw error;
  return data;
}

/** 担当者選択用の一覧（代表・管理者は全アクティブ従業員、従業員は自分のみ）と準備金残高 */
export async function getStaffOptions(me: Profile) {
  const supabase = await createClient();
  const balances = await getFundBalances();
  const byOwner = new Map(balances.filter((b) => b.kind === "staff_reserve").map((b) => [b.owner_profile_id, b.balance]));
  if (!isManager(me)) return [{ id: me.id, name: me.display_name, balance: byOwner.get(me.id) ?? 0 }];
  const { data, error } = await supabase.from("profiles").select("id, display_name").eq("is_active", true).order("display_name");
  if (error) throw error;
  return data.map((p) => ({ id: p.id, name: p.display_name, balance: byOwner.get(p.id) ?? 0 }));
}

export async function getSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings").select("*").single();
  if (error) throw error;
  return data;
}

/** 写真の期限付きURL（ログインユーザー権限で発行。Storage ポリシーで認可） */
export async function signedPhotoUrls(paths: string[], expiresIn = 600): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from("item-photos").createSignedUrls(unique, expiresIn);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}
