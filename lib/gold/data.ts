import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getGrades() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("pm_grades").select("code, label, metal").eq("is_active", true).order("sort_order");
  if (error) throw error;
  return data;
}

export async function getPriceSourceName(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("pm_price_source_name").single();
  return data?.pm_price_source_name ?? "参考相場";
}
