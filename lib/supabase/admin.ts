import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicSupabaseEnv } from "./env";

/**
 * サービスロールクライアント（RLS をバイパスする）。
 * 用途は Auth 管理 API（従業員アカウントの作成）に限定し、呼び出し前に必ず代表権限を確認すること。
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  return createClient<Database>(publicSupabaseEnv().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
