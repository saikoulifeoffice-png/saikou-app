"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { AUTH_COOKIE_NAME } from "./env";

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/** ブラウザ用クライアント（写真アップロードのみに使用。RLS / Storage ポリシーが適用される） */
export function createClient() {
  if (!client) {
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    // 相対パス指定時は同一オリジン経由（/sb → Supabase）で接続
    const url = configured.startsWith("/") ? `${window.location.origin}${configured}` : configured;
    client = createBrowserClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookieOptions: { name: AUTH_COOKIE_NAME },
    });
  }
  return client;
}
