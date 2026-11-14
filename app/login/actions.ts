"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toAuthEmail } from "@/lib/auth/login-id";

const schema = z.object({
  email: z.string().trim().min(1, "ログインIDまたはメールアドレスを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
  next: z.string().optional(),
});

export interface LoginState {
  error?: string;
  email?: string;
}

export async function signIn(_: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(formData.get("email") ?? "") };
  const authEmail = toAuthEmail(parsed.data.email);
  if (!authEmail) return { error: "ログインIDまたはメールアドレスの形式が正しくありません", email: parsed.data.email };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: parsed.data.password });
  if (error || !data.user) {
    return { error: "ログインIDまたはパスワードが正しくありません", email: parsed.data.email };
  }
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "このアカウントは無効化されています。管理者にお問い合わせください", email: parsed.data.email };
  }
  // オープンリダイレクト防止: アプリ内パスのみ許可
  const next = parsed.data.next && /^\/(?!\/)[\w\-/]*$/.test(parsed.data.next) ? parsed.data.next : "/home";
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
