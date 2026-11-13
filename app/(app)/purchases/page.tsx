import Link from "next/link";
import { Plus } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { readPeriod } from "@/lib/period";
import { formatDateTime } from "@/lib/date";
import { PAYMENT_METHOD_LABELS, PURCHASE_METHOD_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Yen } from "@/components/yen";
import { Card } from "@/components/ui/card";

export const metadata = { title: "買取履歴" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  const period = readPeriod(sp);
  const supabase = await createClient();
  let q = supabase
    .from("purchase_transactions")
    .select("id, purchase_no, purchased_at, staff_id, method, payment_method, total_incl, status, profiles!purchase_transactions_staff_id_fkey(display_name), purchase_items(count)")
    .gte("purchased_at", period.range.from)
    .lt("purchased_at", period.range.to)
    .order("purchased_at", { ascending: false })
    .limit(200);
  if (!isManager(me)) q = q.eq("staff_id", me.id);
  const { data, error } = await q;
  if (error) throw error;
  const total = data.filter((d) => d.status === "active").reduce((a, d) => a + d.total_incl, 0);

  return (
    <div>
      <PageHeader title="買取履歴" description={isManager(me) ? "全従業員の買取取引" : "自分の買取取引"}
        actions={<Button variant="gold" asChild><Link href="/purchases/new"><Plus /> 買取登録</Link></Button>} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PeriodFilter from={period.from} to={period.to} />
        <p className="text-sm text-muted">{data.length}件 ／ 合計 <Yen value={total} className="font-bold text-navy-900" /></p>
      </div>
      {data.length === 0 ? (
        <EmptyState title="この期間の買取はありません" action={<Button asChild><Link href="/purchases/new">買取を登録する</Link></Button>} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {data.map((p) => (
              <li key={p.id}>
                <Link href={`/purchases/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-navy-50">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="num font-semibold">{p.purchase_no}</span>
                      {p.status === "voided" && <Badge tone="negative">取消</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {formatDateTime(p.purchased_at)}・{PURCHASE_METHOD_LABELS[p.method]}・{PAYMENT_METHOD_LABELS[p.payment_method]}・
                      {(p.purchase_items as unknown as { count: number }[])[0]?.count ?? 0}点
                      {isManager(me) && `・${(p.profiles as unknown as { display_name: string })?.display_name}`}
                    </p>
                  </div>
                  <Yen value={p.total_incl} className={p.status === "voided" ? "text-muted line-through" : "font-bold"} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
