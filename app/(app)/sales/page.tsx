import Link from "next/link";
import { Plus } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { readPeriod } from "@/lib/period";
import { formatDate, formatDateTime, jstDateString } from "@/lib/date";
import { CHANNEL_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Yen } from "@/components/yen";
import { cn } from "@/lib/utils";

export const metadata = { title: "販売履歴・入金管理" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireProfile();
  const sp = await searchParams;
  const period = readPeriod(sp);
  const view = sp.view === "unpaid" ? "unpaid" : "all";
  const channel = typeof sp.channel === "string" && sp.channel in CHANNEL_LABELS ? sp.channel : "";
  const supabase = await createClient();
  let q = supabase
    .from("sales")
    .select("id, sale_no, kind, channel, sold_at, buyer_name, status, revenue_incl, direct_expense_incl, expected_receipt_amount, payment_due_date, payment_status, sales_staff:profiles!sales_sales_staff_id_fkey(display_name)")
    .order("sold_at", { ascending: false })
    .limit(300);
  if (view === "unpaid") {
    q = q.neq("payment_status", "paid").eq("status", "confirmed").eq("kind", "sale");
  } else {
    q = q.gte("sold_at", period.range.from).lt("sold_at", period.range.to);
  }
  if (channel) q = q.eq("channel", channel as keyof typeof CHANNEL_LABELS);
  const { data, error } = await q;
  if (error) throw error;
  const confirmed = data.filter((s) => s.status === "confirmed");
  const revenue = confirmed.reduce((a, s) => a + s.revenue_incl, 0);
  const unpaid = confirmed.filter((s) => s.payment_status !== "paid" && s.kind === "sale").reduce((a, s) => a + s.expected_receipt_amount, 0);
  const today = jstDateString();
  const tab = (v: string, label: string) => (
    <Link href={`/sales?view=${v}&from=${period.from}&to=${period.to}`} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", view === v ? "bg-navy-700 text-white" : "text-muted")}>{label}</Link>
  );

  return (
    <div>
      <PageHeader title="販売履歴・入金管理" description={isManager(me) ? "全社の販売" : "自分が販売・買取に関わった販売"}
        actions={<Button variant="gold" asChild><Link href="/sales/new"><Plus /> 販売登録</Link></Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border bg-surface p-0.5">{tab("all", "販売履歴")}{tab("unpaid", "未入金一覧")}</div>
        {view === "all" && <PeriodFilter from={period.from} to={period.to} />}
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link href={`/sales?view=${view}&from=${period.from}&to=${period.to}`} className={cn("rounded-full border px-3 py-1", !channel ? "border-navy-700 bg-navy-700 text-white" : "border-border bg-surface")}>全経路</Link>
        {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
          <Link key={k} href={`/sales?view=${view}&from=${period.from}&to=${period.to}&channel=${k}`}
            className={cn("rounded-full border px-3 py-1", channel === k ? "border-navy-700 bg-navy-700 text-white" : "border-border bg-surface")}>{v}</Link>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-muted">{view === "unpaid" ? "対象件数" : "売上（税込・返品控除後）"}</p>
          <p className="num text-2xl font-bold">{view === "unpaid" ? `${data.length}件` : <Yen value={revenue} />}</p></div>
        <div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-muted">未入金額（入金予定額ベース）</p>
          <p className="num text-2xl font-bold text-warning"><Yen value={unpaid} /></p></div>
      </div>
      {data.length === 0 ? (
        <EmptyState title={view === "unpaid" ? "未入金の販売はありません" : "この期間の販売はありません"} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {data.map((s) => {
              const overdue = s.payment_status !== "paid" && s.payment_due_date && s.payment_due_date < today && s.status === "confirmed";
              return (
                <li key={s.id}>
                  <Link href={`/sales/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-navy-50">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="num font-semibold">{s.sale_no}</span>
                        {s.kind === "return" ? <Badge tone="warning">返品</Badge> : <Badge>{CHANNEL_LABELS[s.channel]}</Badge>}
                        {s.status === "cancelled" && <Badge tone="negative">キャンセル</Badge>}
                        {s.status === "confirmed" && s.kind === "sale" && (
                          <Badge tone={s.payment_status === "paid" ? "positive" : overdue ? "negative" : "warning"}>
                            {overdue ? "入金遅延" : PAYMENT_STATUS_LABELS[s.payment_status]}
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {formatDateTime(s.sold_at)}{s.buyer_name && `・${s.buyer_name}`}・{(s.sales_staff as unknown as { display_name: string })?.display_name}
                        {s.payment_status !== "paid" && s.payment_due_date && `・入金予定 ${formatDate(s.payment_due_date)}`}
                      </p>
                    </div>
                    <Yen value={s.revenue_incl} className={cn("font-bold", s.status === "cancelled" && "text-muted line-through")} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
