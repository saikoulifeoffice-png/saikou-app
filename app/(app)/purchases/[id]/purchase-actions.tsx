"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/date";
import { revealIdentity, voidOrRequestVoid } from "../actions";

export function PurchaseActions({ purchaseId, isManager, hasPendingRequest }: { purchaseId: string; isManager: boolean; hasPendingRequest: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [key] = React.useState(() => crypto.randomUUID());
  if (hasPendingRequest) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <XCircle className="text-negative" /> {isManager ? "買取を取消" : "取消を申請"}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} tone="danger" pending={pending}
        title={isManager ? "買取を取消しますか？" : "買取の取消を申請しますか？"}
        description={isManager ? "在庫から除外し、支払元口座へ返金仕訳を記録します。記録は削除されず取消履歴として残ります。" : "代表・管理者の承認後に取消されます。"}
        confirmLabel={isManager ? "取消する" : "申請する"}
        onConfirm={() => start(async () => {
          const r = await voidOrRequestVoid(purchaseId, reason, key);
          if (!r.ok) { setError(r.error.message); return; }
          setOpen(false);
          router.refresh();
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <Field label="理由" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
      </ConfirmDialog>
    </>
  );
}

export function IdentityReveal({ recordId, method, retainUntil }: { recordId: string; method: string; retainUntil: string }) {
  const [open, setOpen] = React.useState(false);
  const [purpose, setPurpose] = React.useState("");
  const [data, setData] = React.useState<Record<string, string | undefined> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2"><ShieldCheck className="size-4 text-navy-500" />本人確認: {method}
          <span className="text-xs text-muted">（保存期限 {formatDate(retainUntil)}）</span></p>
        {!data && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Eye /> 表示</Button>}
      </div>
      {data && (
        <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">住所</dt><dd>{data.address || "—"}</dd>
          <dt className="text-muted">生年月日</dt><dd>{data.birth_date || "—"}</dd>
          <dt className="text-muted">職業</dt><dd>{data.occupation || "—"}</dd>
          <dt className="text-muted">証明書番号</dt><dd>{data.id_document_number || "—"}</dd>
        </dl>
      )}
      <ConfirmDialog open={open} onOpenChange={setOpen} title="本人確認情報の表示" pending={pending} confirmLabel="表示する"
        description="閲覧は監査ログに記録されます。業務上必要な場合のみ表示してください。"
        onConfirm={() => start(async () => {
          const r = await revealIdentity(recordId, purpose);
          if (!r.ok) { setError(r.error.message); return; }
          setData(r.data as unknown as Record<string, string>);
          setOpen(false);
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <Field label="閲覧目的" required><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="例: 警察からの照会対応" /></Field>
      </ConfirmDialog>
    </div>
  );
}
