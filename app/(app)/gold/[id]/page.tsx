import { notFound } from "next/navigation";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatHundredths, parseHundredths } from "@/lib/gold/calc";
import { formatMargin, marginBasisPoints } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { Yen } from "@/components/yen";
import { VoidButton } from "./void-button";

export const metadata = { title: "買取詳細" };

const BASIS = { market: "当日相場", market_previous: "直近の相場", manual: "手入力" } as const;

export default async function GoldDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: d } = await supabase
    .from("pm_purchases")
    .select("*, staff:profiles!pm_purchases_staff_id_fkey(display_name), entered:profiles!pm_purchases_entered_by_fkey(display_name), pm_purchase_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (!d) notFound();
  const items = [...(d.pm_purchase_items as unknown as {
    id: string; line_no: number; item_name: string | null; grade_code: string; weight_g: number; unit_price: number;
    price_basis: keyof typeof BASIS; market_price_date: string | null; metal_value: number;
  }[])].sort((a, b) => a.line_no - b.line_no);

  return (
    <div className="space-y-4">
      <PageHeader title={`${d.customer_name} 様`} description={`${formatDate(d.purchased_on)}・${d.purchase_no}`} back={{ href: "/gold", label: "買取履歴" }}
        actions={isManager(me) && d.status === "active" ? <VoidButton id={id} /> : undefined} />
      {d.status === "voided" && <Alert tone="error" title="この買取は取消済みです">{formatDateTime(d.voided_at)}・理由: {d.void_reason}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="地金総額" value={d.total_metal_value} highlight />
        <StatCard label="買取金額（支払額）" value={d.paid_amount} />
        <StatCard label="見込み利益" value={d.expected_profit} tone="auto" />
        <StatCard label="利益率" value={null} unit="text" text={formatMargin(marginBasisPoints(d.expected_profit ?? 0, d.total_metal_value))} />
      </div>
      <Card>
        <CardHeader><CardTitle>お客様</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <div><p className="text-xs text-muted">名前</p><p className="font-semibold">{d.customer_name}</p></div>
          <div><p className="text-xs text-muted">電話番号</p><p>{d.customer_phone ?? "—"}</p></div>
          <div><p className="text-xs text-muted">住所</p><p>{d.customer_address ?? "—"}</p></div>
          <div><p className="text-xs text-muted">買取担当</p><p>{(d.staff as unknown as { display_name: string })?.display_name}</p></div>
          <div><p className="text-xs text-muted">入力者・登録日時</p><p>{(d.entered as unknown as { display_name: string })?.display_name}・{formatDateTime(d.created_at)}</p></div>
          {d.note && <div><p className="text-xs text-muted">備考</p><p className="whitespace-pre-wrap">{d.note}</p></div>}
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>商品（{items.length}点）</CardTitle></CardHeader>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{i.grade_code} {i.item_name && <span className="font-normal">{i.item_name}</span>}</p>
                <p className="num text-xs text-muted">
                  {formatHundredths(parseHundredths(String(i.weight_g)))}g × {formatHundredths(parseHundredths(String(i.unit_price)))}円/g
                  <Badge tone={i.price_basis === "manual" ? "warning" : "muted"} className="ml-2">{BASIS[i.price_basis]}{i.market_price_date && ` ${formatDate(i.market_price_date)}`}</Badge>
                </p>
              </div>
              <Yen value={i.metal_value} className="font-bold" />
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-xs text-muted">※ 単価は登録時点の参考相場を保存しています。相場を後から修正しても、この記録は変わりません。</p>
    </div>
  );
}
