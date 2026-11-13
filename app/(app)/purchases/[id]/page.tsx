import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/date";
import { CONDITION_LABELS, ITEM_STATUS_LABELS, PAYMENT_METHOD_LABELS, PURCHASE_METHOD_LABELS } from "@/lib/labels";
import { TAX_CATEGORY_LABELS } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Yen } from "@/components/yen";
import { PurchaseActions, IdentityReveal } from "./purchase-actions";

export const metadata = { title: "買取取引" };

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from("purchase_transactions")
    .select("*, staff:profiles!purchase_transactions_staff_id_fkey(display_name), entered:profiles!purchase_transactions_entered_by_fkey(display_name), customers(name, name_kana, phone), fund_accounts(name)")
    .eq("id", id)
    .maybeSingle();
  if (!tx) notFound();
  const [{ data: items }, { data: pendingReq }, { data: idRecords }] = await Promise.all([
    supabase.from("purchase_items").select("id, item_no, name, brand, model_no, condition, quantity, cost_incl, cost_excl, tax_category, status, parent_item_id")
      .eq("purchase_transaction_id", id).is("parent_item_id", null).order("line_no"),
    supabase.from("approval_requests").select("id, status").eq("target_id", id).eq("request_type", "purchase_void").eq("status", "pending").maybeSingle(),
    // 本人確認記録は存在と確認方法のみ取得（内容は表示操作時に監査ログ付きで取得）
    supabase.rpc("purchase_identity_records", { p_purchase_id: id }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title={`買取 ${tx.purchase_no}`} back={{ href: "/purchases", label: "買取履歴" }}
        actions={tx.status === "active" ? <PurchaseActions purchaseId={id} isManager={isManager(me)} hasPendingRequest={!!pendingReq} /> : undefined} />
      {tx.status === "voided" && (
        <Alert tone="error" title="この買取は取消済みです">
          {formatDateTime(tx.voided_at)}・理由: {tx.void_reason}
        </Alert>
      )}
      {pendingReq && <Alert tone="info">取消の承認申請中です</Alert>}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Info label="買取日時" value={formatDateTime(tx.purchased_at)} />
          <Info label="買取担当" value={(tx.staff as unknown as { display_name: string })?.display_name} />
          <Info label="入力者" value={(tx.entered as unknown as { display_name: string })?.display_name} />
          <Info label="買取方法" value={PURCHASE_METHOD_LABELS[tx.method]} />
          <Info label="支払方法" value={PAYMENT_METHOD_LABELS[tx.payment_method]} />
          <Info label="支払元" value={(tx.fund_accounts as unknown as { name: string })?.name} />
          <Info label="合計（税込）" value={<Yen value={tx.total_incl} className="text-lg font-bold" />} />
          <Info label="うち消費税" value={<Yen value={tx.total_tax} />} />
          {tx.note && <Info label="備考" value={tx.note} className="col-span-2 sm:col-span-4" />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>顧客</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {tx.customers ? (
            <div className="space-y-3">
              <p><span className="font-semibold">{(tx.customers as unknown as { name: string }).name}</span>
                <span className="ml-2 text-muted">{(tx.customers as unknown as { name_kana: string | null }).name_kana}</span></p>
              {(idRecords ?? []).map((r) => (
                <IdentityReveal key={r.id} recordId={r.id} method={r.verification_method} retainUntil={r.retain_until} />
              ))}
            </div>
          ) : <p className="text-muted">顧客情報の記録なし</p>}
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader><CardTitle>商品（{items?.length ?? 0}点）</CardTitle></CardHeader>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {(items ?? []).map((i) => (
            <li key={i.id}>
              <Link href={`/items/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-navy-50 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{i.brand && `${i.brand} `}{i.name}{i.quantity > 1 && ` ×${i.quantity}`}</p>
                  <p className="text-xs text-muted"><span className="num">{i.item_no}</span>・{CONDITION_LABELS[i.condition]}・{TAX_CATEGORY_LABELS[i.tax_category]}</p>
                </div>
                <Badge tone={i.status === "in_stock" ? "positive" : i.status === "voided" ? "negative" : "muted"}>{ITEM_STATUS_LABELS[i.status]}</Badge>
                <Yen value={i.cost_incl} className="w-28 text-right font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Info({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-0.5 font-medium">{value ?? "—"}</div>
    </div>
  );
}
