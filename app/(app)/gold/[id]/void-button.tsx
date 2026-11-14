"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Textarea } from "@/components/ui/input";
import { deleteGoldPurchase, voidGoldPurchase } from "../actions";

/** 取消（記録は残し集計から除外）と削除（記録を消す。内容は監査ログに保存） */
export function VoidButton({ id, canVoid = true }: { id: string; canVoid?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"void" | "delete" | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      {canVoid && <Button variant="outline" size="sm" onClick={() => setMode("void")}><XCircle className="text-negative" /> 取消</Button>}
      <Button variant="outline" size="sm" onClick={() => setMode("delete")}><Trash2 className="text-negative" /> 削除</Button>
      <ConfirmDialog open={mode !== null} onOpenChange={(v) => !v && setMode(null)} tone="danger" pending={pending}
        title={mode === "delete" ? "この買取記録を削除しますか？" : "この買取を取消しますか？"}
        confirmLabel={mode === "delete" ? "削除する" : "取消する"}
        description={mode === "delete"
          ? "履歴・集計から完全に消えます（元に戻せません）。削除した内容は監査ログに保存されます。"
          : "集計から除外されます。記録は削除されず、取消履歴として残ります。"}
        onConfirm={() => start(async () => {
          const r = mode === "delete" ? await deleteGoldPurchase(id, reason) : await voidGoldPurchase(id, reason);
          if (!r.ok) return setError(r.error.message);
          if (mode === "delete") router.replace("/gold");
          else { setMode(null); router.refresh(); }
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <Field label={mode === "delete" ? "削除理由" : "取消理由"} required>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "delete" ? "例: テスト入力のため" : undefined} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
