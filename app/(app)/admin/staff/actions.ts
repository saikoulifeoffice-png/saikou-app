"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, toAppError, type ActionResult } from "@/lib/errors";
import { uuidSchema } from "@/lib/validation/common";

const createSchema = z.object({
  display_name: z.string().trim().min(1, "氏名を入力してください").max(100),
  email: z.email("メールアドレスの形式が正しくありません"),
  password: z.string().min(10, "初期パスワードは10文字以上").regex(/[A-Za-z]/, "英字を含めてください").regex(/\d/, "数字を含めてください"),
  role: z.enum(["owner", "admin", "staff"]),
});

/** 従業員アカウントの作成（代表のみ）。Auth 管理 API のためサービスロールを使用する */
export async function createStaff(input: z.input<typeof createSchema>): Promise<ActionResult> {
  await requireOwner();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "VALIDATION", message: parsed.error.issues[0].message } };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    app_metadata: { role: parsed.data.role },
    user_metadata: { display_name: parsed.data.display_name },
  });
  if (error) {
    return fail("CREATE_FAILED", /already|exists|registered/i.test(error.message) ? "このメールアドレスは既に登録されています" : "アカウントを作成できませんでした");
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
