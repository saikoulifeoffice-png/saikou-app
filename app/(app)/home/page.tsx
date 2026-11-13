import Link from "next/link";
import { HandCoins, ShoppingBag, Wallet } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getSummary } from "@/lib/reports";
import { jstRange, presetRange, formatDateTime } from "@/lib/date";
import { formatMargin, marginBasisPoints } from "@/lib/money";
import { CHANNEL_LABELS } from "@/lib/labels";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Yen } from "@/components/yen";

export const metadata = { title: "ホーム" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const me = await requireProfile();
  const { denied } = await searchParams;
  const month = presetRange("this_month");
  const today = presetRange("today");
  const mr = jstRange(month.from, month.to);
  const tr = jstRange(today.from, today.to);
  const supabase = await createClient();
  const [m, t, { data: purchases }, { data: sales }, { data: requests }] = await Promise.all([
    getSummary(mr.from, mr.to, me.id),
    getSummary(tr.from, tr.to, me.id),
    supabase.from("purchase_transactions").select("id, purchase_no, purchased_at, total_incl, status").eq("staff_id", me.id).order("purchased_at", { ascending: false }).limit(5),
    supabase.from("sales").select("id, sale_no, sold_at, revenue_incl, channel, kind, status").eq("sales_staff_id", me.id).order("sold_at", { ascending: false }).limit(5),
    supabase.from("approval_requests").select("id").eq("requested_by", me.id).eq("status", "pending"),
  ]);
  return (
    <div className="space-y-5">
      {denied && <Alert tone="warning">そのページを表示する権限がありません</Alert>}
      <div>
        <p className="text-sm text-muted">おつかれさまです</p>
        <h1 className="text-2xl font-bold text-navy-900">{me.display_name} さん</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Button asChild variant="gold" size="lg" className="h-16 text-base"><Link href="/purchases/new"><HandCoins className="!size-6" />買取登録</Link></Button>
        <Button asChild size="lg" className="h-16 text-base"><Link href="/sales/new"><ShoppingBag className="!size-6" />販売登録</Link></Button>
        <Button asChild variant="outline" size="lg" className="col-span-2 h-16 text-base sm:col-span-1"><Link href="/funds"><Wallet className="!size-6" />準備金</Link></Button>
      </div>

      <StatCard label="買取準備金 残高" value={m.reserve_balance} highlight sub={requests?.length ? `承認待ちの申請 ${requests.length}件` : "台帳から自動計算"} />

      <section>
        <h2 className="mb-2 text-sm font-bold text-navy-800">今月の個人実績 <span className="font-normal text-muted">（買取担当として・{m.tax_basis === "incl" ? "税込" : "税抜"}）</span></h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="売上" value={m.revenue} sub={`本日 ${t.revenue.toLocaleString("ja-JP")}円`} />
          <StatCard label="純利益" value={m.net_profit} tone="auto" sub={`利益率 ${formatMargin(marginBasisPoints(m.net_profit, m.revenue))}`} />
          <StatCard label="買取使用金額" value={m.purchase_amount} sub={`${m.purchase_count}件`} />
          <StatCard label="在庫原価" value={m.inventory_cost} sub={`${m.inventory_quantity}点`} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>最近の買取</CardTitle><Link href="/purchases" className="text-xs font-semibold text-navy-600">すべて</Link></CardHeader>
          <CardContent>
            {!purchases?.length ? <p className="text-sm text-muted">まだ買取がありません</p> : (
              <ul className="divide-y divide-border text-sm">
                {purchases.map((p) => (
                  <li key={p.id}><Link href={`/purchases/${p.id}`} className="flex justify-between gap-2 py-2">
                    <span><span className="num font-semibold">{p.purchase_no}</span> <span className="text-xs text-muted">{formatDateTime(p.purchased_at)}</span>{p.status === "voided" && <Badge tone="negative" className="ml-1">取消</Badge>}</span>
                    <Yen value={p.total_incl} />
                  </Link></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>最近の販売</CardTitle><Link href="/sales" className="text-xs font-semibold text-navy-600">すべて</Link></CardHeader>
          <CardContent>
            {!sales?.length ? <p className="text-sm text-muted">まだ販売がありません</p> : (
              <ul className="divide-y divide-border text-sm">
                {sales.map((s) => (
                  <li key={s.id}><Link href={`/sales/${s.id}`} className="flex justify-between gap-2 py-2">
                    <span><span className="num font-semibold">{s.sale_no}</span> <span className="text-xs text-muted">{s.kind === "return" ? "返品" : CHANNEL_LABELS[s.channel]}</span>{s.status === "cancelled" && <Badge tone="negative" className="ml-1">キャンセル</Badge>}</span>
                    <Yen value={s.revenue_incl} />
                  </Link></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {isManager(me) && (
        <Button variant="outline" asChild className="w-full"><Link href="/dashboard">全社ダッシュボードを見る</Link></Button>
      )}
    </div>
  );
}
