"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { YenInput } from "@/components/yen-input";
import { formatYen } from "@/lib/money";
import { fromJstLocalInput, toJstLocalInput } from "@/lib/date";
import { cancelOrRequestCancel, recordPayment, registerReturn } from "../actions";

interface Returnable { id: string; name: string; item_no: string; max: number; revenue: number }

export function SaleActions({ saleId, isReturn, isManager, hasPendingCancel, remainingReceipt, returnable }: {
  saleId: string; isReturn: boolean; isManager: boolean; hasPendingCancel: boolean; remainingReceipt: number; returnable: Returnable[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<"payment" | "return" | "cancel" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  // payment
  const [kind, setKind] = React.useState<"receipt" | "refund">(remainingReceipt < 0 ? "refund" : "receipt");
  const [amount, setAmount] = React.useState<number | null>(Math.abs(remainingReceipt) || null);
  const [receivedAt, setReceivedAt] = React.useState(toJstLocalInput());
  const [method, setMethod] = React.useState("");
  // return
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [refund, setRefund] = React.useState<number | null>(null);
  const [returnShipping, setReturnShipping] = React.useState<number | null>(null);
  // cancel
  const [reason, setReason] = React.useState("");

  function close() { setDialog(null); setError(null); setKey(crypto.randomUUID()); }
  function done() { close(); router.refresh(); }

  const selected = returnable.filter((r) => (qty[r.id] ?? 0) > 0);
  const refundDefault = selected.reduce((a, r) => a + Math.floor((r.revenue * (qty[r.id] ?? 0)) / r.max), 0);

  return (
    <>
      {!isReturn && <Button variant="outline" size="sm" onClick={() => setDialog("payment")}><Banknote /> 入金登録</Button>}
      {isReturn && remainingReceipt < 0 && <Button variant="outline" size="sm" onClick={() => setDialog("payment")}><Banknote /> 返金登録</Button>}
      {!isReturn && returnable.length > 0 && <Button variant="outline" size="sm" onClick={() => setDialog("return")}><Undo2 /> 返品</Button>}
      {!isReturn && !hasPendingCancel && (
        <Button variant="outline" size="sm" onClick={() => setDialog("cancel")}><XCircle className="text-negative" /> {isManager ? "キャンセル" : "キャンセル申請"}</Button>
      )}

      <ConfirmDialog open={dialog === "payment"} onOpenChange={(v) => !v && close()} title={kind === "refund" ? "返金の登録" : "入金の登録"} pending={pending}
        confirmLabel="登録する" description={`未入金残 ${formatYen(remainingReceipt)}`}
        onConfirm={() => start(async () => {
          const r = await recordPayment({ idempotency_key: key, sale_id: saleId, kind, amount: amount ?? 0, received_at: fromJstLocalInput(receivedAt), method });
          if (!r.ok) return setError(r.error.message);
          done();
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <div className="grid gap-3">
          <Field label="種別"><Select value={kind} onChange={(e) => setKind(e.target.value as "receipt" | "refund")}><option value="receipt">入金</option><option value="refund">返金</option></Select></Field>
          <Field label="金額" required><YenInput value={amount} onChange={setAmount} aria-label="金額" /></Field>
          <Field label="入金日時" required><Input type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></Field>
          <Field label="入金方法"><Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="現金／振込／プラットフォーム" /></Field>
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "return"} onOpenChange={(v) => !v && close()} title="返品の登録" tone="danger" pending={pending} confirmLabel="返品を登録"
        description="商品は在庫に戻り、返品日の期間に売上・原価がマイナス計上されます。"
        onConfirm={() => start(async () => {
          const r = await registerReturn({
            idempotency_key: key, original_sale_id: saleId, returned_at: new Date().toISOString(),
            lines: selected.map((s) => ({ sale_item_id: s.id, quantity: qty[s.id] })),
            refund_total_incl: refund ?? undefined,
            expenses: returnShipping ? [{ expense_type: "shipping", amount_incl: returnShipping, tax_category: "standard_10" }] : [],
          });
          if (!r.ok) return setError(r.error.message);
          close();
          router.push(`/sales/${r.data.sale_id}`);
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <ul className="space-y-2">
          {returnable.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.name}</p><p className="num text-xs text-muted">{r.item_no}・返品可能 {r.max}</p></div>
              <Input type="number" min={0} max={r.max} className="w-20" aria-label={`${r.name}の返品数`} value={qty[r.id] ?? 0}
                onChange={(e) => setQty({ ...qty, [r.id]: Math.min(r.max, Math.max(0, Number(e.target.value) || 0)) })} />
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="返金額" hint={`既定 ${formatYen(refundDefault)}（減額返金の場合のみ入力）`}><YenInput value={refund} onChange={setRefund} aria-label="返金額" /></Field>
          <Field label="返送料（自社負担）"><YenInput value={returnShipping} onChange={setReturnShipping} aria-label="返送料" /></Field>
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === "cancel"} onOpenChange={(v) => !v && close()} tone="danger" pending={pending}
        title={isManager ? "販売をキャンセルしますか？" : "キャンセルを申請しますか？"} confirmLabel={isManager ? "キャンセルする" : "申請する"}
        description={isManager ? "誤登録の訂正用です。売上から除外し在庫に戻します（記録は残ります）。実際の返品は「返品」を使ってください。" : "代表・管理者の承認後にキャンセルされます。"}
        onConfirm={() => start(async () => {
          const r = await cancelOrRequestCancel(saleId, reason, key);
          if (!r.ok) return setError(r.error.message);
          done();
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <Field label="理由" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
      </ConfirmDialog>
    </>
  );
}
