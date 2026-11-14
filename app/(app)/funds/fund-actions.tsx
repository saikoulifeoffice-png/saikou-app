"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Calculator, PlusCircle, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/input";
import { YenInput } from "@/components/yen-input";
import { formatYen } from "@/lib/money";
import { createFundRequest, fundOperation, recordReconciliation } from "./actions";

type Op = "replenish" | "return_to_company" | "transfer" | "opening" | "req_replenish" | "req_transfer" | "recon" | "req_adjust";

const TITLES: Record<Op, string> = {
  replenish: "資金補充（会社 → 準備金）",
  return_to_company: "資金返却（準備金 → 会社）",
  transfer: "従業員間移動",
  opening: "初期残高の登録",
  req_replenish: "資金補充の申請",
  req_transfer: "従業員間移動の申請",
  recon: "現金照合",
  req_adjust: "残高調整の申請",
};

export function FundActions({ manager, canOperate, account, reserves, companies, staff, lastReconciliation }: {
  manager: boolean;
  canOperate: boolean;
  account: { id: string; kind: string; name: string; balance: number; isMine: boolean; hasTx: boolean };
  reserves: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  lastReconciliation: { id: string; difference: number } | null;
}) {
  const router = useRouter();
  const [op, setOp] = React.useState<Op | null>(null);
  const [amount, setAmount] = React.useState<number | null>(null);
  const [counter, setCounter] = React.useState("");
  const [memo, setMemo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [pending, start] = React.useTransition();
  const isReserve = account.kind === "staff_reserve";

  function open(o: Op) {
    setOp(o); setError(null); setAmount(o === "req_adjust" && lastReconciliation ? lastReconciliation.difference : null); setMemo(""); setKey(crypto.randomUUID());
    setCounter(o === "transfer" ? (reserves.find((r) => r.id !== account.id)?.id ?? "") : o === "req_transfer" ? (staff[0]?.id ?? "") : (companies[0]?.id ?? ""));
  }

  function submit() {
    start(async () => {
      let r;
      if (op === "replenish" || op === "return_to_company" || op === "transfer" || op === "opening") {
        r = await fundOperation({ idempotency_key: key, type: op, account_id: account.id, counterpart_account_id: op === "opening" ? undefined : counter || undefined, amount: amount ?? 0, memo });
      } else if (op === "req_replenish" || op === "req_transfer" || op === "req_adjust") {
        r = await createFundRequest({
          idempotency_key: key,
          request_type: op === "req_replenish" ? "fund_replenish" : op === "req_transfer" ? "fund_transfer" : "fund_adjustment",
          target_id: account.id, amount: amount ?? 0, to_profile_id: op === "req_transfer" ? counter : undefined,
          reconciliation_id: op === "req_adjust" ? lastReconciliation?.id : undefined, reason: memo,
        });
      } else if (op === "recon") {
        const res = await recordReconciliation({ account_id: account.id, counted_amount: amount ?? -1, note: memo });
        if (res.ok) setInfo(res.data.difference === 0 ? "台帳残高と一致しました" : `差異 ${formatYen(res.data.difference, { sign: true })} を記録しました。必要に応じて調整を申請してください。`);
        r = res;
      }
      if (r && !r.ok) { setError(r.error.message); return; }
      setOp(null);
      router.refresh();
    });
  }

  const needsAmount = op !== null;
  const reasonRequired = op === "req_replenish" || op === "req_transfer" || op === "req_adjust";

  return (
    <>
      {info && <Alert tone="info" className="w-full">{info}</Alert>}
      {canOperate && isReserve && (
        <>
          <Button variant="gold" onClick={() => open("replenish")}><ArrowDownToLine /> 補充</Button>
          <Button variant="outline" onClick={() => open("return_to_company")}><ArrowUpFromLine /> 返却</Button>
          <Button variant="outline" onClick={() => open("transfer")}><ArrowLeftRight /> 移動</Button>
        </>
      )}
      {canOperate && !account.hasTx && <Button variant="outline" onClick={() => open("opening")}><PlusCircle /> 初期残高</Button>}
      {!manager && account.isMine && (
        <>
          <Button variant="gold" onClick={() => open("req_replenish")}><ArrowDownToLine /> 補充を申請</Button>
          <Button variant="outline" onClick={() => open("req_transfer")}><ArrowLeftRight /> 移動を申請</Button>
        </>
      )}
      {(manager || account.isMine) && <Button variant="outline" onClick={() => open("recon")}><Calculator /> 現金照合</Button>}
      {(manager || account.isMine) && lastReconciliation && <Button variant="outline" onClick={() => open("req_adjust")}><Scale /> 差異の調整を申請</Button>}

      <ConfirmDialog open={op !== null} onOpenChange={(v) => !v && setOp(null)} title={op ? TITLES[op] : ""} pending={pending}
        confirmLabel={reasonRequired ? "申請する" : "確定する"} tone={op === "recon" ? "primary" : "gold"}
        description={op === "recon" ? `手元の現金を数えて入力してください（台帳残高 ${formatYen(account.balance)}）` : `対象: ${account.name}（現在残高 ${formatYen(account.balance)}）`}
        onConfirm={submit}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <div className="grid gap-3">
          {(op === "replenish" || op === "return_to_company") && (
            <Field label={op === "replenish" ? "補充元" : "返却先"}>
              <Select value={counter} onChange={(e) => setCounter(e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </Field>
          )}
          {op === "transfer" && (
            <Field label="移動先">
              <Select value={counter} onChange={(e) => setCounter(e.target.value)}>{reserves.filter((r) => r.id !== account.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
            </Field>
          )}
          {op === "req_transfer" && (
            <Field label="移動先の従業員">
              <Select value={counter} onChange={(e) => setCounter(e.target.value)}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            </Field>
          )}
          {needsAmount && op === "req_adjust" ? (
            <Field label="調整額（増額はプラス、減額はマイナス）" required>
              <Input type="number" inputMode="numeric" value={amount ?? ""} onChange={(e) => setAmount(e.target.value === "" ? null : Math.trunc(Number(e.target.value)))} className="num text-right" />
            </Field>
          ) : needsAmount ? (
            <Field label={op === "recon" ? "実査額" : "金額"} required><YenInput value={amount} onChange={setAmount} aria-label="金額" /></Field>
          ) : null}
          <Field label={reasonRequired ? "理由" : "メモ"} required={reasonRequired}><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
          {op === "return_to_company" || op === "transfer" ? (
            amount !== null && amount > account.balance && <Alert tone="error">残高を超えています</Alert>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
