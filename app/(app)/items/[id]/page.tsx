import Link from "next/link";
import { notFound } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { requireProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { signedPhotoUrls } from "@/lib/data";
import { formatDateTime } from "@/lib/date";
import { CHANNEL_LABELS, CONDITION_LABELS, ITEM_STATUS_LABELS } from "@/lib/labels";
import { TAX_CATEGORY_LABELS } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Yen } from "@/components/yen";
import { ItemPhotos, SplitItemButton } from "./item-client";

export const metadata = { title: "商品詳細" };

interface ItemDetail {
  id: string; item_no: string; name: string; brand: string | null; model_no: string | null; serial_no: string | null;
  condition: keyof typeof CONDITION_LABELS; category_name: string; status: keyof typeof ITEM_STATUS_LABELS;
  quantity: number; stock_quantity: number; staff_name: string; purchased_at: string; storage_location: string | null;
  note: string | null; tax_category: keyof typeof TAX_CATEGORY_LABELS; parent_item_id: string | null; parent_item_no: string | null;
  purchase_transaction_id: string | null; purchase_no: string | null; can_see_cost: boolean; can_edit: boolean;
  cost_incl: number | null; stock_cost_incl: number | null;
  photos: { id: string; path: string }[];
  children: { id: string; item_no: string; name: string; status: keyof typeof ITEM_STATUS_LABELS }[];
  sales: { sale_id: string; sale_no: string; kind: "sale" | "return"; status: string; sold_at: string; channel: keyof typeof CHANNEL_LABELS;
    quantity: number; revenue_incl: number; cost_incl: number; direct_expense_incl: number; profit_incl: number; sales_staff_name: string }[] | null;
}

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_item", { p_item_id: id });
  if (error) notFound();
  const item = data as unknown as ItemDetail;
  const urls = await signedPhotoUrls(item.photos.map((p) => p.path));
  const inStock = item.status === "in_stock" || item.status === "partially_sold";
  const untouched = item.status === "in_stock" && (item.sales ?? []).length === 0 && item.stock_quantity === item.quantity;

  return (
    <div className="space-y-4">
      <PageHeader title={item.name} description={item.brand ?? undefined} back={{ href: "/items", label: "商品一覧" }}
        actions={
          <>
            {inStock && <Button variant="gold" asChild><Link href={`/sales/new?item=${item.id}`}><ShoppingBag /> この商品を販売</Link></Button>}
            {item.can_edit && untouched && item.cost_incl !== null && <SplitItemButton itemId={item.id} cost={item.cost_incl} name={item.name} />}
          </>
        } />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardContent>
            <ItemPhotos itemId={item.id} canEdit={item.can_edit} photos={item.photos.map((p) => ({ id: p.id, url: urls[p.path] }))} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={inStock ? "positive" : item.status === "voided" ? "negative" : "muted"}>{ITEM_STATUS_LABELS[item.status]}</Badge>
              <Badge>{item.category_name}</Badge>
              <Badge tone="gold">状態 {CONDITION_LABELS[item.condition]}</Badge>
            </div>
            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-2">
              <dt className="text-muted">商品番号</dt><dd className="num font-semibold">{item.item_no}</dd>
              <dt className="text-muted">型番</dt><dd>{item.model_no ?? "—"}</dd>
              {item.can_see_cost && <><dt className="text-muted">製造番号</dt><dd>{item.serial_no ?? "—"}</dd></>}
              <dt className="text-muted">数量</dt><dd className="num">在庫 {item.stock_quantity} / 取得 {item.quantity}</dd>
              <dt className="text-muted">保管場所</dt><dd>{item.storage_location ?? "—"}</dd>
              <dt className="text-muted">買取担当</dt><dd>{item.staff_name}</dd>
              <dt className="text-muted">買取日時</dt><dd>{formatDateTime(item.purchased_at)}</dd>
              {item.purchase_no && <><dt className="text-muted">買取取引</dt><dd><Link className="num text-navy-600 hover:underline" href={`/purchases/${item.purchase_transaction_id}`}>{item.purchase_no}</Link></dd></>}
              {item.parent_item_no && <><dt className="text-muted">分割元</dt><dd><Link className="num text-navy-600 hover:underline" href={`/items/${item.parent_item_id}`}>{item.parent_item_no}</Link></dd></>}
              <dt className="text-muted">税区分</dt><dd>{TAX_CATEGORY_LABELS[item.tax_category]}</dd>
              {item.can_see_cost ? (
                <>
                  <dt className="text-muted">買取原価</dt><dd><Yen value={item.cost_incl} className="text-lg font-bold" /></dd>
                  <dt className="text-muted">在庫原価</dt><dd><Yen value={item.stock_cost_incl} /></dd>
                </>
              ) : (
                <><dt className="text-muted">原価</dt><dd className="text-muted">他の担当者の商品のため非表示</dd></>
              )}
              {item.note && <><dt className="text-muted">備考</dt><dd className="whitespace-pre-wrap">{item.note}</dd></>}
            </dl>
          </CardContent>
        </Card>
      </div>
      {item.children.length > 0 && (
        <Card>
          <CardHeader><CardTitle>分割後の商品</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {item.children.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <Link href={`/items/${c.id}`} className="text-navy-600 hover:underline"><span className="num">{c.item_no}</span> {c.name}</Link>
                  <Badge tone="muted">{ITEM_STATUS_LABELS[c.status]}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {item.sales && item.sales.length > 0 && (
        <Card>
          <CardHeader><CardTitle>販売履歴</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {item.sales.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/sales/${s.sale_id}`} className="text-navy-600 hover:underline">
                    <span className="num">{s.sale_no}</span> {s.kind === "return" ? "返品" : CHANNEL_LABELS[s.channel]}
                    {s.status === "cancelled" && <Badge tone="negative" className="ml-1">キャンセル</Badge>}
                  </Link>
                  <span className="text-muted">{formatDateTime(s.sold_at)}・{s.sales_staff_name}</span>
                  <span>売上 <Yen value={s.revenue_incl} /> ／ 利益 <Yen value={s.profit_incl} tone="auto" className="font-semibold" /></span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
