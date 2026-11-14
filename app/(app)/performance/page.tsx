import Link from "next/link";
import { Download } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { readPeriod } from "@/lib/period";
import { bucketLabel, getSummary, getTimeseries, TAX_BASIS_LABEL } from "@/lib/reports";
import { formatMargin, marginBasisPoints } from "@/lib/money";
import { CHANNEL_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendChart } from "@/components/charts/trend-chart";
import { TimeseriesTable } from "@/components/timeseries-table";
import { StaffSelect } from "./staff-select";
import { Yen } from "@/components/yen";

export const metadata = { title: "個人実績" };

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  const p = readPeriod(sp);
  const manager = isManager(me);
  const staffId = manager && typeof sp.staff === "string" && /^[0-9a-f-]{36}$/.test(sp.staff) ? sp.staff : me.id;
  const supabase = await createClient();
  const [summary, series, { data: channels }, { data: categories }, staffList] = await Promise.all([
    getSummary(p.range.from, p.range.to, staffId),
    getTimeseries(p.from, p.to, p.grain, staffId),
    supabase.rpc("report_breakdown", { p_from: p.range.from, p_to: p.range.to, p_dimension: "channel", p_staff: staffId }),
    supabase.rpc("report_breakdown", { p_from: p.range.from, p_to: p.range.to, p_dimension: "category", p_staff: staffId }),
    manager ? supabase.from("profiles").select("id, display_name").order("display_name").then((r) => r.data ?? []) : Promise.resolve([]),
  ]);
  const rows = series.map((r) => ({ ...r, label: bucketLabel(r.bucket, p.grain) }));
  const csv = `/api/export/timeseries?from=${p.from}&to=${p.to}&grain=${p.grain}&staff=${staffId}`;
  const name = staffList.find((s) => s.id === staffId)?.display_name ?? me.display_name;

  return (
    <div className="space-y-4">
      <PageHeader title="個人売上・利益分析" description={`${name} さん（買取担当として帰属した実績・${TAX_BASIS_LABEL[summary.tax_basis]}）`}
        actions={<Button variant="outline" size="sm" asChild><a href={csv}><Download /> CSV</a></Button>} />
      <div className="flex flex-wrap items-center gap-2">
        {manager && <StaffSelect staff={staffList} value={staffId} />}
        <PeriodFilter from={p.from} to={p.to} grain={p.grain} showGrain />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="売上" value={summary.revenue} highlight sub={`販売 ${summary.sales_count}件・返品 ${summary.return_count}件`} />
        <StatCard label="粗利益" value={summary.gross_profit} tone="auto" sub={`売上原価 ${summary.cost_of_sales.toLocaleString("ja-JP")}円`} />
        <StatCard label="純利益（管理上）" value={summary.net_profit} tone="auto" sub={`販売直接費 ${summary.direct_expense.toLocaleString("ja-JP")}円`} />
        <StatCard label="利益率" value={null} unit="text" text={formatMargin(marginBasisPoints(summary.net_profit, summary.revenue))} sub="純利益 ÷ 売上" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="買取使用金額" value={summary.purchase_amount} sub={`${summary.purchase_count}件`} />
        <StatCard label="在庫原価（期末）" value={summary.inventory_cost} sub={`${summary.inventory_quantity}点`} />
        <StatCard label="準備金残高（現在）" value={summary.reserve_balance} />
        <StatCard label="未入金（販売担当分）" value={summary.receivables} />
      </div>
      <Card>
        <CardHeader><CardTitle>推移</CardTitle></CardHeader>
        <CardContent>
          <TrendChart data={rows} />
          <TimeseriesTable rows={rows} />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="販売経路別" rows={(channels ?? []).map((c) => ({ ...c, label: CHANNEL_LABELS[c.key as keyof typeof CHANNEL_LABELS] ?? c.label }))} />
        <Breakdown title="カテゴリー別" rows={categories ?? []} />
      </div>
      <p className="text-xs text-muted">※ 一般経費の配賦は Phase 2 で実装予定のため、現在の純利益は「粗利益 − 販売直接費」です。<Link href="/sales" className="ml-1 underline">販売履歴</Link></p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; label: string; revenue: number; net_profit: number; quantity: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-sm text-muted">この期間の実績はありません</p> : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-left">区分</th><th className="text-right">数量</th><th className="text-right">売上</th><th className="text-right">純利益</th><th className="text-right">利益率</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key}><td className="py-1.5">{r.label}</td><td className="num text-right">{r.quantity}</td><td className="text-right"><Yen value={r.revenue} /></td>
                  <td className="text-right"><Yen value={r.net_profit} tone="auto" /></td><td className="num text-right">{formatMargin(marginBasisPoints(r.net_profit, r.revenue))}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
