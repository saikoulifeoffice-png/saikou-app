import Link from "next/link";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getFundBalances } from "@/lib/data";
import { formatDateTime } from "@/lib/date";
import { ACCOUNT_KIND_LABELS, FUND_TX_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Yen } from "@/components/yen";
import { FundActions } from "./fund-actions";
import { cn } from "@/lib/utils";

export const metadata = { title: "買取準備金" };

export default async function FundsPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const me = await requireProfile();
  const manager = isManager(me);
  const sp = await searchParams;
  const balances = await getFundBalances();
  const mine = balances.find((b) => b.kind === "staff_reserve" && b.owner_profile_id === me.id);
  const selectedId = sp.account && balances.some((b) => b.account_id === sp.account) ? sp.account : (mine?.account_id ?? balances[0]?.account_id);
  const selected = balances.find((b) => b.account_id === selectedId);
  const supabase = await createClient();
  const [{ data: txs }, { data: recons }, { data: staff }, { data: myRequests }, { count: txCount }] = await Promise.all([
    supabase.from("fund_transactions").select("id, tx_type, amount, occurred_at, memo, transfer_group_id, purchase_transaction_id, created_at")
      .eq("account_id", selectedId!).order("occurred_at", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("fund_reconciliations").select("id, counted_at, counted_amount, ledger_balance, difference, note, adjustment_request_id")
      .eq("account_id", selectedId!).order("counted_at", { ascending: false }).limit(5),
    supabase.from("profiles").select("id, display_name").eq("is_active", true).order("display_name"),
    supabase.from("approval_requests").select("id, request_type, status, payload, requested_at").eq("requested_by", me.id)
      .in("request_type", ["fund_replenish", "fund_transfer", "fund_adjustment"]).order("requested_at", { ascending: false }).limit(5),
    supabase.from("fund_transactions").select("id", { count: "exact", head: true }).eq("account_id", selectedId!),
  ]);
  // 残高推移（新しい順の一覧に、その時点の残高を付与）
  const ledger = withRunningBalance(txs ?? [], selected?.balance ?? 0);
  const reserves = balances.filter((b) => b.kind === "staff_reserve");
  const companies = balances.filter((b) => b.kind !== "staff_reserve");

  return (
    <div className="space-y-4">
      <PageHeader title="買取準備金" description="残高は資金台帳から自動計算されます（直接の上書きはできません）" />
      {manager && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[...reserves, ...companies].map((b) => (
            <Link key={b.account_id} href={`/funds?account=${b.account_id}`}
              className={cn("shrink-0 rounded-xl border px-3 py-2 text-sm", b.account_id === selectedId ? "border-navy-700 bg-navy-700 text-white" : "border-border bg-surface")}>
              <p className="text-xs opacity-80">{b.owner_name ?? ACCOUNT_KIND_LABELS[b.kind]}{!b.is_active && "（無効）"}</p>
              <p className="num font-bold">{b.balance.toLocaleString("ja-JP")}円</p>
            </Link>
          ))}
        </div>
      )}
      {selected && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <StatCard label={`${selected.owner_name ?? ACCOUNT_KIND_LABELS[selected.kind]} の残高`} value={selected.balance} highlight
              sub={selected.last_tx_at ? `最終取引 ${formatDateTime(selected.last_tx_at)}` : "取引なし"} />
            <div className="flex flex-wrap gap-2">
              <FundActions
                manager={manager}
                canOperate={manager}
                account={{ id: selected.account_id, kind: selected.kind, name: selected.owner_name ?? ACCOUNT_KIND_LABELS[selected.kind], balance: selected.balance, isMine: selected.owner_profile_id === me.id, hasTx: (txCount ?? 0) > 0 }}
                reserves={reserves.map((r) => ({ id: r.account_id, name: r.owner_name ?? "" }))}
                companies={companies.map((c) => ({ id: c.account_id, name: ACCOUNT_KIND_LABELS[c.kind] }))}
                staff={(staff ?? []).filter((s) => s.id !== me.id).map((s) => ({ id: s.id, name: s.display_name }))}
                lastReconciliation={recons?.[0] && !recons[0].adjustment_request_id && recons[0].difference !== 0 ? { id: recons[0].id, difference: recons[0].difference ?? 0 } : null}
              />
            </div>
          </div>
          {!!myRequests?.length && (
            <Card>
              <CardHeader><CardTitle>自分の申請</CardTitle><Link href="/approvals" className="text-xs font-semibold text-navy-600">承認画面</Link></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {myRequests.map((r) => (
                    <li key={r.id} className="flex justify-between py-2">
                      <span>{formatDateTime(r.requested_at)}</span>
                      <Yen value={Number((r.payload as { amount?: number })?.amount ?? 0)} />
                      <Badge tone={r.status === "approved" ? "positive" : r.status === "pending" ? "warning" : "muted"}>{{ pending: "承認待ち", approved: "承認済", rejected: "却下", withdrawn: "取下げ" }[r.status]}</Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>資金台帳</CardTitle><span className="text-xs text-muted">新しい順・最大200件</span></CardHeader>
            {ledger.length === 0 ? <CardContent><EmptyState title="取引がありません" description="代表・管理者が資金補充を行うと記録されます" /></CardContent> : (
              <ul className="mt-3 divide-y divide-border border-t border-border">
                {ledger.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2"><Badge tone={t.amount > 0 ? "positive" : "neutral"}>{FUND_TX_LABELS[t.tx_type]}</Badge>
                        <span className="truncate text-muted">{t.purchase_transaction_id ? <Link href={`/purchases/${t.purchase_transaction_id}`} className="underline">{t.memo}</Link> : t.memo}</span></p>
                      <p className="text-xs text-muted">{formatDateTime(t.occurred_at)}</p>
                    </div>
                    <div className="text-right">
                      <Yen value={t.amount} sign tone="auto" className="font-semibold" />
                      <p className="num text-xs text-muted">残高 {t.balance_after.toLocaleString("ja-JP")}円</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {!!recons?.length && (
            <Card>
              <CardHeader><CardTitle>現金照合の履歴</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border text-sm">
                  {recons.map((r) => (
                    <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <span>{formatDateTime(r.counted_at)}</span>
                      <span>実査 <Yen value={r.counted_amount} /> ／ 台帳 <Yen value={r.ledger_balance} /></span>
                      <span>差異 <Yen value={r.difference} tone="auto" className="font-semibold" />{r.adjustment_request_id && <Badge tone="muted" className="ml-1">調整申請済</Badge>}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function withRunningBalance<T extends { amount: number }>(rows: T[], current: number): (T & { balance_after: number })[] {
  const out: (T & { balance_after: number })[] = [];
  let running = current;
  for (const t of rows) {
    out.push({ ...t, balance_after: running });
    running -= t.amount;
  }
  return out;
}
