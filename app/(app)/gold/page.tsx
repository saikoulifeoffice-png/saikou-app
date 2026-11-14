import Link from "next/link";
import { Plus } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { readPeriod } from "@/lib/period";
import { formatDate } from "@/lib/date";
import { formatMargin, marginBasisPoints } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Yen } from "@/components/yen";
import { cn } from "@/lib/utils";

export const metadata = { title: "買取履歴" };

export default async function GoldHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireProfile();
  const manager = isManager(me);
  const sp = await searchParams;
  const p = readPeriod(sp);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 50) : "";
  const staffFilter = manager && typeof sp.staff === "string" && /^[0-9a-f-]{36}$/.test(sp.staff) ? sp.staff : "";
  const supabase = await createClient();
  let query = supabase
    .from("pm_purchases")
    .select("id, purchase_no, purchased_on, customer_name, paid_amount, total_metal_value, expected_profit, status, staff:profiles!pm_purchases_staff_id_fkey(display_name), pm_purchase_items(count)")
    .gte("purchased_on", p.from)
    .lte("purchased_on", p.to)
    .order("purchased_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  if (q) query = query.ilike("customer_name", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (staffFilter) query = query.eq("staff_id", staffFilter);
  const [{ data, error }, { data: staffList }] = await Promise.all([
    query,
    manager ? supabase.from("profiles").select("id, display_name").order("display_name") : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  if (error) throw error;
  const active = data.filter((d) => d.status === "active");
  const metal = active.reduce((a, d) => a + d.total_metal_value, 0);
  const paid = active.reduce((a, d) => a + d.paid_amount, 0);
  const profit = metal - paid;

  return (
    <div className="space-y-4">
      <PageHeader title="買取履歴" description={manager ? "全従業員の買取" : "自分が担当した買取"}
        actions={<Button variant="gold" asChild><Link href="/gold/new"><Plus /> 買取登録</Link></Button>} />
      <PeriodFilter from={p.from} to={p.to} />
      <form className="flex flex-wrap gap-2" role="search">
        <input type="hidden" name="from" value={p.from} />
        <input type="hidden" name="to" value={p.to} />
        <Input name="q" defaultValue={q} placeholder="お客様の名前で検索" aria-label="お客様の名前" className="min-w-0 flex-1" />
        {manager && (
          <Select name="staff" defaultValue={staffFilter} aria-label="担当者" className="w-36">
            <option value="">全担当者</option>
            {(staffList ?? []).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </Select>
        )}
        <Button type="submit">検索</Button>
      </form>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="地金総額" value={metal} highlight sub={`${active.length}件`} />
        <StatCard label="買取金額（支払額）" value={paid} />
        <StatCard label="見込み利益" value={profit} tone="auto" />
        <StatCard label="利益率" value={null} unit="text" text={formatMargin(marginBasisPoints(profit, metal))} sub="見込み利益 ÷ 地金総額" />
      </div>
      {data.length === 0 ? (
        <EmptyState title="該当する買取はありません" action={<Button asChild><Link href="/gold/new">買取を登録する</Link></Button>} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {data.map((d) => (
              <li key={d.id}>
                <Link href={`/gold/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-navy-50">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-semibold">{d.customer_name} 様
                      {d.status === "voided" && <Badge tone="negative">取消</Badge>}</p>
                    <p className="truncate text-xs text-muted">
                      {formatDate(d.purchased_on)}・<span className="num">{d.purchase_no}</span>・{(d.pm_purchase_items as unknown as { count: number }[])[0]?.count ?? 0}点
                      {manager && `・${(d.staff as unknown as { display_name: string })?.display_name}`}
                    </p>
                  </div>
                  <div className={cn("text-right text-sm", d.status === "voided" && "text-muted line-through")}>
                    <p className="text-xs text-muted">地金 <span className="num">{d.total_metal_value.toLocaleString("ja-JP")}</span>円 / 支払 <span className="num">{d.paid_amount.toLocaleString("ja-JP")}</span>円</p>
                    <p className="font-bold">利益 <Yen value={d.expected_profit} tone={d.status === "voided" ? "none" : "auto"} /></p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-xs text-muted">※ 地金総額・見込み利益は参考相場による見込み額で、実際の売却価格ではありません。</p>
    </div>
  );
}
