"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";

const schema = z
  .object({
    current: z.string().min(1, "現在のパスワードを入力してください"),
    password: z
      .string()
      .min(10, "10文字以上で入力してください")
      .regex(/[A-Za-z]/, "英字を含めてください")
      .regex(/\d/, "数字を含めてください"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "確認用パスワードが一致しません", path: ["confirm"] });

export interface PasswordState {
  error?: string;
  ok?: boolean;
}

export async function changePassword(_: PasswordState, formData: FormData): Promise<PasswordState> {
  const profile = await requireProfile();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const email = claims?.claims?.email as string | undefined;
  if (!email || claims?.claims?.sub !== profile.id) return { error: "再ログインしてください" };
  // 現在のパスワードを再確認
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: parsed.data.current });
  if (verifyError) return { error: "現在のパスワードが正しくありません" };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "パスワードを変更できませんでした" };
  return { ok: true };
}
