"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, toAppError, type ActionResult } from "@/lib/errors";
import { uuidSchema } from "@/lib/validation/common";
import { toAuthEmail } from "@/lib/auth/login-id";

const createSchema = z.object({
  display_name: z.string().trim().min(1, "氏名を入力してください").max(100),
  email: z.string().trim().min(1, "ログインIDまたはメールアドレスを入力してください"),
  password: z.string().min(10, "初期パスワードは10文字以上").regex(/[A-Za-z]/, "英字を含めてください").regex(/\d/, "数字を含めてください"),
  role: z.enum(["owner", "admin", "staff"]),
});

/** 従業員アカウントの作成（代表のみ）。Auth 管理 API のためサービスロールを使用する */
export async function createStaff(input: z.input<typeof createSchema>): Promise<ActionResult> {
  await requireOwner();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const email = toAuthEmail(parsed.data.email);
  if (!email) return fail("VALIDATION", "ログインIDは半角英小文字・数字（3〜30文字）、またはメールアドレスで入力してください");
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    app_metadata: { role: parsed.data.role },
    user_metadata: { display_name: parsed.data.display_name },
  });
  if (error) {
    return fail("CREATE_FAILED", /already|exists|registered/i.test(error.message) ? "このログインID（メールアドレス）は既に登録されています" : "アカウントを作成できませんでした");
  }
  revalidatePath("/admin/staff");
  return { ok: true, data: undefined };
}

export async function setRole(userId: string, role: "owner" | "admin" | "staff"): Promise<ActionResult> {
  await requireOwner();
  if (!uuidSchema.safeParse(userId).success) return fail("VALIDATION", "IDが不正です");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_role", { p_user_id: userId, p_role: role });
  if (error) return { ok: false, error: toAppError(error) };
  revalidatePath("/admin/staff");
  return { ok: true, data: undefined };
}

export async function setActive(userId: string, active: boolean): Promise<ActionResult> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_active", { p_user_id: userId, p_active: active });
  if (error) return { ok: false, error: toAppError(error) };
  if (!active) {
    // 無効化した従業員のセッションを失効させる
    await createAdminClient().auth.admin.signOut(userId).catch(() => undefined);
  }
  revalidatePath("/admin/staff");
  return { ok: true, data: undefined };
}

const passwordSchema = z.string().min(10, "10文字以上で入力してください").regex(/[A-Za-z]/, "英字を含めてください").regex(/\d/, "数字を含めてください");

/** 従業員のパスワード再設定（代表のみ）。ログインIDのアカウントはメールで再設定できないため */
export async function resetStaffPassword(userId: string, password: string): Promise<ActionResult> {
  const me = await requireOwner();
  if (!uuidSchema.safeParse(userId).success) return fail("VALIDATION", "IDが不正です");
  if (userId === me.id) return fail("VALIDATION", "自分のパスワードはアカウント画面で変更してください");
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return fail("VALIDATION", parsed.error.issues[0].message);
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return fail("RESET_FAILED", "パスワードを再設定できませんでした");
  // 再設定前のセッションは無効化（変更はSupabase Authの監査ログに記録される）
  await admin.auth.admin.signOut(userId).catch(() => undefined);
  return { ok: true, data: undefined };
}
