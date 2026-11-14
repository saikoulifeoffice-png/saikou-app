import Link from "next/link";
import { Download } from "lucide-react";
import { requireManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { readPeriod } from "@/lib/period";
import { bucketLabel, getSummary, getTimeseries, TAX_BASIS_LABEL } from "@/lib/reports";
import { formatMargin, marginBasisPoints } from "@/lib/money";
import { ACCOUNT_KIND_LABELS, CHANNEL_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendChart } from "@/components/charts/trend-chart";
import { TimeseriesTable } from "@/components/timeseries-table";
import { Yen } from "@/components/yen";
import { getFundBalances } from "@/lib/data";

export const metadata = { title: "全社ダッシュボード" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireManager();
  const p = readPeriod(await searchParams);
  const supabase = await createClient();
  const [s, series, { data: ranking }, { data: channels }, balances] = await Promise.all([
    getSummary(p.range.from, p.range.to, null),
    getTimeseries(p.from, p.to, p.grain, null),
    supabase.rpc("report_staff_ranking", { p_from: p.range.from, p_to: p.range.to }),
    supabase.rpc("report_breakdown", { p_from: p.range.from, p_to: p.range.to, p_dimension: "channel" }),
    getFundBalances(),
  ]);
  const rows = series.map((r) => ({ ...r, label: bucketLabel(r.bucket, p.grain) }));
  const q = `from=${p.from}&to=${p.to}&grain=${p.grain}`;
  return (
    <div className="space-y-4">
      <PageHeader title="全社ダッシュボード" description={`集計基準: ${TAX_BASIS_LABEL[s.tax_basis]}`}
        actions={<Button variant="outline" size="sm" asChild><a href={`/api/export/timeseries?${q}`}><Download /> 推移CSV</a></Button>} />
      <PeriodFilter from={p.from} to={p.to} grain={p.grain} showGrain />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="総売上" value={s.revenue} highlight sub={`販売 ${s.sales_count}件・返品 ${s.return_count}件`} />
        <StatCard label="粗利益" value={s.gross_profit} tone="auto" sub={`売上原価 ${s.cost_of_sales.toLocaleString("ja-JP")}円`} />
        <StatCard label="管理上の純利益" value={s.net_profit} tone="auto" sub={`販売直接費 ${s.direct_expense.toLocaleString("ja-JP")}円`} />
        <StatCard label="利益率" value={null} unit="text" text={formatMargin(marginBasisPoints(s.net_profit, s.revenue))} sub="純利益 ÷ 総売上" />
        <StatCard label="買取使用金額" value={s.purchase_amount} sub={`${s.purchase_count}件`} />
        <StatCard label="在庫原価（期末）" value={s.inventory_cost} sub={`${s.inventory_quantity}点`} />
        <StatCard label="準備金残高合計" value={s.reserve_balance} />
        <StatCard label="未入金" value={s.receivables} sub={<Link href="/sales?view=unpaid" className="underline">一覧</Link>} />
      </div>
      <Card>
        <CardHeader><CardTitle>売上・純利益の推移</CardTitle></CardHeader>
        <CardContent><TrendChart data={rows} /><TimeseriesTable rows={rows} /></CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>従業員別ランキング（純利益順）</CardTitle>
            <a href={`/api/export/ranking?${q}`} className="text-xs font-semibold text-navy-600">CSV</a></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-1 text-left">#</th><th className="text-left">従業員</th><th className="text-right">売上</th><th className="text-right">純利益</th><th className="text-right">利益率</th><th className="text-right">買取額</th><th className="text-right">販売担当売上</th></tr></thead>
              <tbody className="divide-y divide-border">
                {(ranking ?? []).map((r, i) => (
                  <tr key={r.staff_id}>
                    <td className="num py-2 font-bold text-gold-600">{i + 1}</td>
                    <td><Link className="hover:underline" href={`/performance?staff=${r.staff_id}&${q}`}>{r.display_name}</Link></td>
                    <td className="text-right"><Yen value={r.revenue} /></td>
                    <td className="text-right font-semibold"><Yen value={r.net_profit} tone="auto" /></td>
                    <td className="num text-right">{formatMargin(marginBasisPoints(r.net_profit, r.revenue))}</td>
                    <td className="text-right"><Yen value={r.purchase_amount} /></td>
                    <td className="text-right text-muted"><Yen value={r.sold_by_staff_revenue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">売上・利益は買取担当に帰属。「販売担当売上」は参考値です。</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>販売経路別</CardTitle></CardHeader>
          <CardContent>
            {!channels?.length ? <p className="text-sm text-muted">この期間の販売はありません</p> : (
              <ul className="divide-y divide-border text-sm">
                {channels.map((c) => (
                  <li key={c.key} className="flex items-center justify-between py-2">
                    <span>{CHANNEL_LABELS[c.key as keyof typeof CHANNEL_LABELS]}</span>
                    <span className="text-right"><Yen value={c.revenue} /><span className="ml-2 text-xs text-muted">利益 <Yen value={c.net_profit} /></span></span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>資金残高（現在）</CardTitle><Link href="/funds" className="text-xs font-semibold text-navy-600">資金管理へ</Link></CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <li key={b.account_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span>{b.owner_name ?? ACCOUNT_KIND_LABELS[b.kind]}</span><Yen value={b.balance} tone={b.balance < 0 ? "auto" : "none"} className="font-semibold" />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">本社現金・本社口座は準備金補充・振込買取の相手勘定です（売上入金は Phase 1 では資金台帳に連動しません）。</p>
        </CardContent>
      </Card>
    </div>
  );
}
