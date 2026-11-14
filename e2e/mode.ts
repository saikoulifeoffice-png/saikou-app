import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/** テスト用に画面モードを切り替える（ローカル Supabase のみ） */
export async function setUiMode(mode: "simple" | "full") {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const url = configured.startsWith("/") ? process.env.SUPABASE_INTERNAL_URL! : configured;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { error } = await admin.from("app_settings").update({ ui_mode: mode }).eq("id", true);
  if (error) throw error;
}
