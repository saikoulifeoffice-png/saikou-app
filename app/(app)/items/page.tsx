import Link from "next/link";
import { ImageOff } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getCategories, signedPhotoUrls } from "@/lib/data";
import { formatDate } from "@/lib/date";
import { CONDITION_LABELS, ITEM_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Yen } from "@/components/yen";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const metadata = { title: "商品・在庫" };
const PAGE = 50;

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  const q = sp.q?.slice(0, 100) ?? "";
  const status = ["in_stock", "sold", "split", "voided", "all"].includes(sp.status ?? "") ? sp.status! : "in_stock";
  const scope = sp.scope === "mine" ? "mine" : "all";
  const category = sp.category && /^[0-9a-f-]{36}$/.test(sp.category) ? sp.category : null;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const supabase = await createClient();
  const [categories, { data, error }] = await Promise.all([
    getCategories(),
    supabase.rpc("search_items", { p_q: q || undefined, p_category: category ?? undefined, p_status: status, p_scope: scope, p_limit: PAGE, p_offset: page * PAGE }),
  ]);
  if (error) throw error;
  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const urls = await signedPhotoUrls(rows.map((r) => r.photo_path).filter((p): p is string => !!p));
  const qs = (o: Record<string, string | number>) => {
    const s = new URLSearchParams({ q, status, scope, ...(category ? { category } : {}), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    return `?${s.toString()}`;
  };

  return (
    <div>
      <PageHeader title="商品・在庫" description={`${total.toLocaleString("ja-JP")}件`}
        actions={<Button variant="gold" asChild><Link href="/purchases/new">買取登録</Link></Button>} />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="商品名・ブランド・型番・商品番号で検索" aria-label="キーワード" />
        <Select name="status" defaultValue={status} aria-label="状態">
          <option value="in_stock">在庫あり</option>
          <option value="sold">販売済</option>
          <option value="split">分割済</option>
          <option value="voided">取消</option>
          <option value="all">すべて</option>
        </Select>
        <Select name="category" defaultValue={category ?? ""} aria-label="カテゴリー">
          <option value="">全カテゴリー</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select name="scope" defaultValue={scope} aria-label="担当">
          <option value="all">{isManager(me) ? "全担当" : "全員の在庫"}</option>
          <option value="mine">自分の買取</option>
        </Select>
        <Button type="submit">検索</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="該当する商品がありません" description="検索条件を変更してください" />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/items/${r.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-navy-50 sm:px-4">
                  <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-navy-50">
                    {r.photo_path && urls[r.photo_path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={urls[r.photo_path]} alt="" className="size-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid size-full place-items-center text-navy-200"><ImageOff className="size-6" /></div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.brand && <span className="text-navy-500">{r.brand} </span>}{r.name}</p>
                    <p className="truncate text-xs text-muted">
                      <span className="num">{r.item_no}</span>・{r.category_name}・{CONDITION_LABELS[r.condition]}・{formatDate(r.purchased_at)}
                      {!r.is_mine && `・${r.staff_name}`}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={r.status === "in_stock" || r.status === "partially_sold" ? "positive" : r.status === "voided" ? "negative" : "muted"}>{ITEM_STATUS_LABELS[r.status]}</Badge>
                      {r.stock_quantity > 0 && r.quantity > 1 && <Badge>在庫 {r.stock_quantity}/{r.quantity}</Badge>}
                      {r.storage_location && <Badge tone="muted">{r.storage_location}</Badge>}
                    </p>
                  </div>
                  <div className="text-right">
                    {r.can_see_cost ? (
                      <>
                        <p className="text-[10px] text-muted">在庫原価</p>
                        <Yen value={r.stock_cost} className="font-semibold" />
                      </>
                    ) : <p className="text-[10px] text-muted">原価非表示</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {total > PAGE && (
        <div className="mt-4 flex items-center justify-center gap-3">
          {page > 0 && <Button variant="outline" asChild><Link href={qs({ page: page - 1 })}>前へ</Link></Button>}
          <span className="text-sm text-muted">{page + 1} / {Math.ceil(total / PAGE)}</span>
          {(page + 1) * PAGE < total && <Button variant="outline" asChild><Link href={qs({ page: page + 1 })}>次へ</Link></Button>}
        </div>
      )}
    </div>
  );
}
