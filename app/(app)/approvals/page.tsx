import Link from "next/link";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/date";
import { APPROVAL_STATUS_LABELS, APPROVAL_TYPE_LABELS } from "@/lib/labels";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { Yen } from "@/components/yen";
import { DecisionButtons } from "./decision-buttons";
import { cn } from "@/lib/utils";

export const metadata = { title: "承認管理" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireProfile();
  const manager = isManager(me);
  const { tab: t } = await searchParams;
  const tab = t === "history" ? "history" : t === "mine" || !manager ? "mine" : "pending";
  const supabase = await createClient();
  let q = supabase
    .from("approval_requests")
    .select("id, request_type, status, requested_at, reason, payload, target_id, decided_at, decision_note, requested_by, requester:profiles!approval_requests_requested_by_fkey(display_name), decider:profiles!approval_requests_decided_by_fkey(display_name)")
    .order("requested_at", { ascending: false })
    .limit(100);
  if (tab === "pending") q = q.eq("status", "pending");
  else if (tab === "mine") q = q.eq("requested_by", me.id);
  else q = q.neq("status", "pending");
  const { data, error } = await q;
  if (error) throw error;
  const tabs = manager ? [["pending", "承認待ち"], ["history", "処理済み"], ["mine", "自分の申請"]] : [["mine", "自分の申請"]];
  const targetHref = (type: string, id: string | null) =>
    !id ? null : type === "purchase_void" ? `/purchases/${id}` : type === "sale_cancel" ? `/sales/${id}` : `/funds?account=${id}`;

  return (
    <div>
      <PageHeader title="承認管理" description="取消・キャンセル・資金補充・移動・調整は承認後に反映されます" />
      <div className="mb-4 flex w-fit rounded-lg border border-border bg-surface p-0.5">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/approvals?tab=${k}`} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-navy-700 text-white" : "text-muted")}>{l}</Link>
        ))}
      </div>
      {data.length === 0 ? <EmptyState title="申請はありません" /> : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {data.map((r) => {
              const amount = (r.payload as { amount?: number } | null)?.amount;
              const href = targetHref(r.request_type, r.target_id);
              return (
                <li key={r.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="gold">{APPROVAL_TYPE_LABELS[r.request_type]}</Badge>
                    <Badge tone={r.status === "pending" ? "warning" : r.status === "approved" ? "positive" : "muted"}>{APPROVAL_STATUS_LABELS[r.status]}</Badge>
                    {amount !== undefined && amount !== null && <Yen value={Number(amount)} className="font-bold" sign={r.request_type === "fund_adjustment"} />}
                    <span className="text-xs text-muted">{formatDateTime(r.requested_at)}・{(r.requester as unknown as { display_name: string })?.display_name}</span>
                    {href && <Link href={href} className="text-xs font-semibold text-navy-600 underline">対象を確認</Link>}
                  </div>
                  <p className="text-sm">理由: {r.reason}</p>
                  {r.decided_at && <p className="text-xs text-muted">{formatDateTime(r.decided_at)} {(r.decider as unknown as { display_name: string } | null)?.display_name} {r.decision_note && `「${r.decision_note}」`}</p>}
                  {r.status === "pending" && (
                    <DecisionButtons requestId={r.id} canDecide={manager && r.requested_by !== me.id} canWithdraw={r.requested_by === me.id} />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
