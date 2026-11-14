import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { jstRange } from "@/lib/date";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // CSV インジェクション対策（= + - @ で始まる文字列をエスケープ）
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** 分析データの CSV 出力（認可は RPC 側で実施：従業員は自分の範囲のみ） */
export async function GET(req: NextRequest, ctx: { params: Promise<{ report: string }> }) {
  const me = await getCurrentProfile();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { report } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return NextResponse.json({ error: "invalid period" }, { status: 400 });
  const grain = ["day", "week", "month", "year"].includes(sp.get("grain") ?? "") ? sp.get("grain")! : "day";
  const staff = sp.get("staff");
  const staffId = staff && /^[0-9a-f-]{36}$/.test(staff) ? staff : undefined;
  const supabase = await createClient();
  let csv: string;
  if (report === "timeseries") {
    const { data, error } = await supabase.rpc("report_timeseries", { p_from: from, p_to: to, p_grain: grain, p_staff: staffId });
    if (error) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    csv = toCsv(["期間開始", "売上", "売上原価", "粗利益", "販売直接費", "純利益", "販売件数", "買取件数", "買取金額"],
      data.map((r) => [r.bucket, r.revenue, r.cost_of_sales, r.gross_profit, r.direct_expense, r.net_profit, r.sales_count, r.purchase_count, r.purchase_amount]));
  } else if (report === "ranking") {
    const r = jstRange(from, to);
    const { data, error } = await supabase.rpc("report_staff_ranking", { p_from: r.from, p_to: r.to });
    if (error) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    csv = toCsv(["従業員", "売上", "売上原価", "粗利益", "販売直接費", "純利益", "販売件数", "買取件数", "買取金額", "販売担当としての売上"],
      data.map((x) => [x.display_name, x.revenue, x.cost_of_sales, x.gross_profit, x.direct_expense, x.net_profit, x.sales_count, x.purchase_count, x.purchase_amount, x.sold_by_staff_revenue]));
  } else if (report === "gold-timeseries") {
    const g = grain === "month" ? "month" : "day";
    const { data, error } = await supabase.rpc("pm_report_timeseries", { p_from: from, p_to: to, p_grain: g, p_staff: staffId });
    if (error) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    csv = toCsv([g === "month" ? "月" : "日", "件数", "地金総額", "買取金額", "見込み利益"],
      data.map((r) => [g === "month" ? r.bucket.slice(0, 7) : r.bucket, r.count, r.total_metal_value, r.paid_amount, r.expected_profit]));
  } else if (report === "gold-staff") {
    const { data, error } = await supabase.rpc("pm_report_by_staff", { p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    csv = toCsv(["従業員", "件数", "買取金額", "地金総額", "見込み利益"],
      data.map((r) => [r.display_name, r.count, r.paid_amount, r.total_metal_value, r.expected_profit]));
  } else {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="saikou-${report}-${from}_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
