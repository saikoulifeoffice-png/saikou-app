import Link from "next/link";
import { Download } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { readPeriod } from "@/lib/period";
import { formatMargin, formatYen, marginBasisPoints } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendChart } from "@/components/charts/trend-chart";
import { Yen } from "@/components/yen";
import { cn } from "@/lib/utils";

export const metadata = { title: "買取集計" };

export default async function GoldReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireProfile();
  const manager = isManager(me);
  const sp = await searchParams;
  const p = readPeriod(sp);
  const grain = sp.grain === "month" ? "month" : "day";
  const supabase = await createClient();
  const [{ data: summary, error: e1 }, { data: series, error: e2 }, staffRes] = await Promise.all([
    supabase.rpc("pm_report_summary", { p_from: p.from, p_to: p.to }),
    supabase.rpc("pm_report_timeseries", { p_from: p.from, p_to: p.to, p_grain: grain }),
    manager ? supabase.rpc("pm_report_by_staff", { p_from: p.from, p_to: p.to }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  const s = summary as unknown as { count: number; total_metal_value: number; paid_amount: number; expected_profit: number };
  const rows = (series ?? []).map((r) => ({
    ...r,
    label: grain === "month" ? `${r.bucket.slice(2, 4)}/${r.bucket.slice(5, 7)}` : `${Number(r.bucket.slice(5, 7))}/${Number(r.bucket.slice(8, 10))}`,
  }));
  const qs = `from=${p.from}&to=${p.to}&grain=${grain}`;
  const grainLink = (g: string, label: string) => (
    <Link href={`/gold/reports?from=${p.from}&to=${p.to}&grain=${g}`} className={cn("rounded-md px-3 py-1.5 text-xs font-semibold", grain === g ? "bg-navy-700 text-white" : "text-muted")}>{label}</Link>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="買取集計" description={manager ? "全社の買取（取消を除く）" : "自分が担当した買取（取消を除く）"}
        actions={<Button variant="outline" size="sm" asChild><a href={`/api/export/gold-timeseries?${qs}`}><Download /> CSV</a></Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <PeriodFilter from={p.from} to={p.to} />
        <div className="flex rounded-lg border border-border bg-surface p-0.5">{grainLink("day", "日別")}{grainLink("month", "月別")}</div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="地金総額" value={s.total_metal_value} highlight sub={`${s.count}件`} />
        <StatCard label="買取金額（支払額）" value={s.paid_amount} />
        <StatCard label="見込み利益" value={s.expected_profit} tone="auto" />
        <StatCard label="利益率" value={null} unit="text" text={formatMargin(marginBasisPoints(s.expected_profit, s.total_metal_value))} />
      </div>
      <Card>
        <CardHeader><CardTitle>{grain === "month" ? "月別" : "日別"}の推移</CardTitle></CardHeader>
        <CardContent>
          <TrendChart data={rows.map((r) => ({ label: r.label, revenue: r.total_metal_value, net_profit: r.expected_profit }))} labels={{ revenue: "地金総額", net_profit: "見込み利益" }} />
          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="sticky top-0 bg-navy-50 text-xs text-muted">
                <tr><th className="px-2 py-1.5 text-left">{grain === "month" ? "月" : "日"}</th><th className="px-2 text-right">件数</th><th className="px-2 text-right">地金総額</th><th className="px-2 text-right">支払額</th><th className="px-2 text-right">見込み利益</th></tr>
              </thead>
              <tbody className="num divide-y divide-border">
                {rows.filter((r) => grain === "month" || r.count > 0).map((r) => (
                  <tr key={r.bucket}><td className="px-2 py-1.5">{grain === "month" ? r.bucket.slice(0, 7) : r.bucket}</td><td className="px-2 text-right">{r.count}</td>
                    <td className="px-2 text-right">{formatYen(r.total_metal_value)}</td><td className="px-2 text-right">{formatYen(r.paid_amount)}</td>
                    <td className={cn("px-2 text-right font-semibold", r.expected_profit < 0 && "text-negative")}>{formatYen(r.expected_profit)}</td></tr>
                ))}
              </tbody>
            </table>
            {grain === "day" && rows.every((r) => r.count === 0) && <p className="py-4 text-center text-sm text-muted">この期間の買取はありません</p>}
          </div>
        </CardContent>
      </Card>
      {manager && staffRes.data && (
        <Card>
          <CardHeader><CardTitle>従業員別</CardTitle><a href={`/api/export/gold-staff?${qs}`} className="text-xs font-semibold text-navy-600">CSV</a></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-1 text-left">従業員</th><th className="text-right">件数</th><th className="text-right">買取金額</th><th className="text-right">地金総額</th><th className="text-right">見込み利益</th><th className="text-right">利益率</th></tr></thead>
              <tbody className="divide-y divide-border">
                {staffRes.data.map((r) => (
                  <tr key={r.staff_id}><td className="py-2">{r.display_name}</td><td className="num text-right">{r.count}</td>
                    <td className="text-right"><Yen value={r.paid_amount} /></td><td className="text-right"><Yen value={r.total_metal_value} /></td>
                    <td className="text-right font-semibold"><Yen value={r.expected_profit} tone="auto" /></td>
                    <td className="num text-right">{formatMargin(marginBasisPoints(r.expected_profit, r.total_metal_value))}</td></tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted">※ 見込み利益は参考相場に基づく見込み額です。実際の売却価格とは異なります。</p>
    </div>
  );
}
