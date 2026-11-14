import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getGrades, getPriceSourceName } from "@/lib/gold/data";
import { formatDate, formatDateTime, jstDateString } from "@/lib/date";
import { formatHundredths, parseHundredths } from "@/lib/gold/calc";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { PricesForm } from "./prices-form";

export const metadata = { title: "相場管理" };

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  const today = jstDateString();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const supabase = await createClient();
  const [grades, sourceName, { data: dayPrices }, { data: recent }] = await Promise.all([
    getGrades(),
    getPriceSourceName(),
    supabase.from("pm_market_prices").select("grade_code, unit_price, source_name, source_url, fetched_at, method, note, updated_at").eq("price_date", date),
    supabase.from("pm_market_prices").select("price_date, grade_code, unit_price, source_name, fetched_at").order("price_date", { ascending: false }).limit(300),
  ]);
  const byDate = new Map<string, { grade_code: string; unit_price: number; source_name: string; fetched_at: string }[]>();
  for (const r of recent ?? []) {
    const list = byDate.get(r.price_date) ?? [];
    list.push({ ...r, unit_price: Number(r.unit_price) });
    byDate.set(r.price_date, list);
  }
  const order = new Map(grades.map((g, i) => [g.code, i]));
  const fmt = (v: number) => formatHundredths(parseHundredths(String(v)));

  return (
    <div className="space-y-4">
      <PageHeader title="参考相場の管理" description="日付・品位ごとの参考相場（円/g）。買取登録時に自動で適用されます" />
      <Alert tone="info" title="相場の取得について">
        {sourceName} は公式に認められた自動取得方法が確認できていないため、代表・管理者が公開されている相場を確認して手動で登録します。
        参考相場は見込み利益の計算用で、実際の売却価格ではありません。
      </Alert>
      {!(dayPrices ?? []).length && date === today && <Alert tone="warning">本日（{formatDate(today)}）の相場が未登録です。未登録の間は直近の過去日の相場が適用されます。</Alert>}
      {isManager(me) ? (
        <Card>
          <CardHeader><CardTitle>相場の登録・修正</CardTitle></CardHeader>
          <CardContent>
            <PricesForm
              key={date}
              date={date}
              today={today}
              grades={grades}
              defaultSourceName={sourceName}
              existing={(dayPrices ?? []).map((p) => ({ grade_code: p.grade_code, unit_price: String(Number(p.unit_price)), source_name: p.source_name, source_url: p.source_url, fetched_at: p.fetched_at, note: p.note }))}
            />
          </CardContent>
        </Card>
      ) : (
        <Alert tone="info">相場の登録は代表・管理者が行います。</Alert>
      )}
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>登録済みの相場</CardTitle></CardHeader>
        <CardContent>
          {byDate.size === 0 ? <EmptyState title="相場が登録されていません" /> : (
            <ul className="space-y-3">
              {[...byDate.entries()].slice(0, 30).map(([d, list]) => (
                <li key={d} className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <a href={`/gold/prices?date=${d}`} className="font-bold text-navy-700 hover:underline">{formatDate(d)}</a>
                    <span className="text-xs text-muted">{list[0].source_name}・取得 {formatDateTime(list[0].fetched_at)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.sort((a, b) => (order.get(a.grade_code) ?? 0) - (order.get(b.grade_code) ?? 0)).map((p) => (
                      <Badge key={p.grade_code} tone="neutral" className="num">{p.grade_code} {fmt(p.unit_price)}円</Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
