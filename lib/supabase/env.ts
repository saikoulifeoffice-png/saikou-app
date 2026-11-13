/**
 * Supabase 接続先
 * - 通常: NEXT_PUBLIC_SUPABASE_URL（絶対URL）をサーバー・ブラウザ共通で使用
 * - 同一オリジン経由モード（スマホからのプレビュー等）:
 *     NEXT_PUBLIC_SUPABASE_URL=/sb            … ブラウザは https://<アプリ>/sb 経由で接続
 *     SUPABASE_INTERNAL_URL=http://127.0.0.1:54321 … サーバーは直接接続し、/sb はここへ転送
 */
export const AUTH_COOKIE_NAME = "sb-saikou-auth-token";

export function isRelativeSupabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").startsWith("/");
}

/** サーバー側から使う接続先 */
export function publicSupabaseEnv() {
  const url = isRelativeSupabaseUrl() ? process.env.SUPABASE_INTERNAL_URL : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が設定されていません（.env.example 参照）");
  }
  return { url, anonKey };
}

/** サーバーで発行した Storage の署名付きURLを、ブラウザから到達できるURLに変換 */
export function toBrowserUrl(url: string): string {
  if (!isRelativeSupabaseUrl()) return url;
  const internal = (process.env.SUPABASE_INTERNAL_URL ?? "").replace(/\/$/, "");
  return internal && url.startsWith(internal) ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}${url.slice(internal.length)}` : url;
}
