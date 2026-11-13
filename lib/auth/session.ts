import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "admin" | "staff";

export interface Profile {
  id: string;
  display_name: string;
  role: Role;
  is_active: boolean;
}

export const ROLE_LABELS: Record<Role, string> = { owner: "代表", admin: "管理者", staff: "従業員" };

/** 現在のユーザー（JWT 検証済み）とプロフィール。リクエスト内でキャッシュ */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, role, is_active")
    .eq("id", uid)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;
  return profile as Profile;
});

export async function requireProfile(): Promise<Profile> {
  const p = await getCurrentProfile();
  if (!p) redirect("/login");
  return p;
}

export function isManager(p: Pick<Profile, "role">) {
  return p.role === "owner" || p.role === "admin";
}

/** 代表・管理者専用ページ（サーバー側で確認。DB 側でも RPC/RLS で再確認される） */
export async function requireManager(): Promise<Profile> {
  const p = await requireProfile();
  if (!isManager(p)) redirect("/home?denied=1");
  return p;
}

export async function requireOwner(): Promise<Profile> {
  const p = await requireProfile();
  if (p.role !== "owner") redirect("/home?denied=1");
  return p;
}
