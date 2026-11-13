import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/date";
import { CHANNEL_LABELS, EXPENSE_TYPE_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { TAX_CATEGORY_LABELS, formatMargin, marginBasisPoints } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Yen } from "@/components/yen";
import { SaleActions } from "./sale-actions";

export const metadata = { title: "販売詳細" };

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: sale } = await supabase
    .from("sales")
    .select("*, sales_staff:profiles!sales_sales_staff_id_fkey(display_name), entered:profiles!sales_entered_by_fkey(display_name)")
    .eq("id", id)
    .maybeSingle();
  if (!sale) notFound();
  const [{ data: lines }, { data: expenses }, { data: payments }, { data: returns }, { data: pendingReq }] = await Promise.all([
    supabase.rpc("get_sale_lines", { p_sale_id: id }),
    supabase.from("sale_expenses").select("*").eq("sale_id", id),
    supabase.from("payment_records").select("*").eq("sale_id", id).order("received_at"),
    supabase.from("sales").select("id, sale_no, sold_at, revenue_incl, status").eq("original_sale_id", id).order("sold_at"),
    supabase.from("approval_requests").select("id").eq("target_id", id).eq("request_type", "sale_cancel").eq("status", "pending").maybeSingle(),
  ]);
  const ls = lines ?? [];
  const costVisible = ls.every((l) => l.cost_incl !== null);
  const cost = ls.reduce((a, l) => a + (l.cost_incl ?? 0), 0);
  const profit = sale.revenue_incl - cost - sale.direct_expense_incl;
  const net = (payments ?? []).reduce((a, p) => a + (p.kind === "receipt" ? p.amount : -p.amount), 0);
  const canOperate = isManager(me) || sale.sales_staff_id === me.id;
  const isReturn = sale.kind === "return";
  const original = sale.original_sale_id
    ? (await supabase.from("sales").select("id, sale_no").eq("id", sale.original_sale_id).maybeSingle()).data
    : null;

  return (
    <div className="space-y-4">
      <PageHeader title={`${isReturn ? "返品" : "販売"} ${sale.sale_no}`} back={{ href: "/sales", label: "販売履歴" }}
        actions={canOperate && sale.status === "confirmed" ? (
          <SaleActions saleId={id} isReturn={isReturn} isManager={isManager(me)} hasPendingCancel={!!pendingReq}
            remainingReceipt={sale.expected_receipt_amount - net}
            returnable={isReturn ? [] : ls.filter((l) => l.quantity - l.returned_quantity > 0).map((l) => ({ id: l.id, name: l.item_name, item_no: l.item_no, max: l.quantity - l.returned_quantity, revenue: l.revenue_incl }))} />
        ) : undefined} />
      {sale.status === "cancelled" && <Alert tone="error" title="キャンセル済み">{formatDateTime(sale.cancelled_at)}・理由: {sale.cancel_reason}</Alert>}
      {pendingReq && <Alert tone="info">キャンセルの承認申請中です</Alert>}
      {original && <Alert tone="warning">元の販売: <Link className="num font-semibold underline" href={`/sales/${original.id}`}>{original.sale_no}</Link></Alert>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={isReturn ? "返金額（売上減）" : "売上（税込）"} value={<Yen value={sale.revenue_incl} />} />
        <Kpi label="販売直接費" value={<Yen value={sale.direct_expense_incl} />} />
        <Kpi label="利益" value={costVisible ? <Yen value={profit} tone="auto" /> : <span className="text-base text-muted">原価非表示</span>} />
        <Kpi label="利益率" value={costVisible ? formatMargin(marginBasisPoints(profit, sale.revenue_incl)) : "—"} />
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Info label="販売経路" value={CHANNEL_LABELS[sale.channel]} />
          <Info label="計上日時" value={formatDateTime(sale.sold_at)} />
          <Info label="販売担当" value={(sale.sales_staff as unknown as { display_name: string })?.display_name} />
          <Info label="入力者" value={(sale.entered as unknown as { display_name: string })?.display_name} />
          <Info label="販売先" value={sale.buyer_name} />
          <Info label="税抜売上" value={<Yen value={sale.revenue_excl} />} />
          <Info label="消費税" value={<Yen value={sale.revenue_tax} />} />
          {sale.note && <Info label="備考" value={sale.note} />}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>明細</CardTitle><span className="text-xs text-muted">実績は買取担当に帰属</span></CardHeader>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-navy-50 text-xs text-muted">
              <tr><th className="px-4 py-2 text-left">商品</th><th className="px-2 py-2 text-left">買取担当</th><th className="px-2 py-2 text-right">数量</th>
                <th className="px-2 py-2 text-right">売上</th><th className="px-2 py-2 text-right">直接費</th><th className="px-2 py-2 text-right">原価</th><th className="px-4 py-2 text-right">利益</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ls.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2"><Link href={`/items/${l.item_id}`} className="font-semibold text-navy-700 hover:underline">{l.item_name}</Link>
                    <p className="text-xs text-muted"><span className="num">{l.item_no}</span>・{TAX_CATEGORY_LABELS[l.tax_category]}{l.returned_quantity > 0 && `・返品済 ${l.returned_quantity}`}</p></td>
                  <td className="px-2 py-2">{l.purchaser_name}</td>
                  <td className="num px-2 py-2 text-right">{l.quantity}</td>
                  <td className="px-2 py-2 text-right"><Yen value={l.revenue_incl} /></td>
                  <td className="px-2 py-2 text-right"><Yen value={l.direct_expense_incl} /></td>
                  <td className="px-2 py-2 text-right">{l.cost_incl === null ? <span className="text-xs text-muted">非表示</span> : <Yen value={l.cost_incl} />}</td>
                  <td className="px-4 py-2 text-right font-semibold">{l.profit_incl === null ? "—" : <Yen value={l.profit_incl} tone="auto" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>販売直接費</CardTitle></CardHeader>
          <CardContent>
            {(expenses ?? []).length === 0 ? <p className="text-sm text-muted">なし</p> : (
              <ul className="divide-y divide-border text-sm">
                {expenses!.map((e) => (
                  <li key={e.id} className="flex justify-between py-2"><span>{EXPENSE_TYPE_LABELS[e.expense_type]}<span className="ml-2 text-xs text-muted">{TAX_CATEGORY_LABELS[e.tax_category]}</span></span><Yen value={e.amount_incl} /></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>入金</CardTitle>
            {sale.status === "confirmed" && <Badge tone={sale.payment_status === "paid" ? "positive" : "warning"}>{PAYMENT_STATUS_LABELS[sale.payment_status]}</Badge>}
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">入金予定額</span><Yen value={sale.expected_receipt_amount} /></div>
            {sale.payment_due_date && <div className="flex justify-between"><span className="text-muted">入金予定日</span><span>{formatDate(sale.payment_due_date)}</span></div>}
            <div className="flex justify-between"><span className="text-muted">入金済額</span><Yen value={net} className="font-semibold" /></div>
            <ul className="divide-y divide-border border-t border-border pt-1">
              {(payments ?? []).map((p) => (
                <li key={p.id} className="flex justify-between py-1.5"><span>{formatDateTime(p.received_at)} {p.kind === "refund" ? "返金" : "入金"} {p.method}</span>
                  <Yen value={p.kind === "refund" ? -p.amount : p.amount} tone="auto" /></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {(returns ?? []).length > 0 && (
        <Card>
          <CardHeader><CardTitle>返品</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {returns!.map((r) => (
                <li key={r.id} className="flex justify-between py-2">
                  <Link href={`/sales/${r.id}`} className="num text-navy-600 hover:underline">{r.sale_no}</Link>
                  <span className="text-muted">{formatDateTime(r.sold_at)}</span>
                  <Yen value={r.revenue_incl} tone="auto" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-muted">{label}</p><div className="num mt-1 text-2xl font-bold">{value}</div></div>;
}
function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-xs text-muted">{label}</p><div className="mt-0.5 font-medium">{value || "—"}</div></div>;
}
