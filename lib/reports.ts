import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface Summary {
  tax_basis: "incl" | "excl";
  staff_id: string | null;
  revenue: number;
  cost_of_sales: number;
  gross_profit: number;
  direct_expense: number;
  general_expense: number;
  net_profit: number;
  sales_count: number;
  return_count: number;
  quantity_sold: number;
  purchase_count: number;
  purchase_amount: number;
  purchase_cash_out: number;
  inventory_quantity: number;
  inventory_cost: number;
  reserve_balance: number;
  receivables: number;
}

export async function getSummary(from: string, to: string, staffId: string | null): Promise<Summary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_summary", { p_from: from, p_to: to, p_staff: staffId ?? undefined });
  if (error) throw error;
  return data as unknown as Summary;
}

export async function getTimeseries(from: string, to: string, grain: string, staffId: string | null) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_timeseries", { p_from: from, p_to: to, p_grain: grain, p_staff: staffId ?? undefined });
  if (error) throw error;
  return data;
}

export function bucketLabel(bucket: string, grain: string) {
  const [y, m, d] = bucket.split("-");
  if (grain === "year") return `${y}年`;
  if (grain === "month") return `${y.slice(2)}/${m}`;
  return `${Number(m)}/${Number(d)}`;
}

export const TAX_BASIS_LABEL = { incl: "税込", excl: "税抜" } as const;
