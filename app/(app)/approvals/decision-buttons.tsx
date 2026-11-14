"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/input";
import { decide, withdraw } from "./actions";

export function DecisionButtons({ requestId, canDecide, canWithdraw }: { requestId: string; canDecide: boolean; canWithdraw: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"approve" | "reject" | "withdraw" | null>(null);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <div className="flex gap-2">
      {canDecide && (
        <>
          <Button size="sm" variant="gold" onClick={() => setMode("approve")}><Check /> 承認</Button>
          <Button size="sm" variant="outline" onClick={() => setMode("reject")}><X /> 却下</Button>
        </>
      )}
      {canWithdraw && <Button size="sm" variant="ghost" onClick={() => setMode("withdraw")}>取り下げ</Button>}
      <ConfirmDialog open={mode !== null} onOpenChange={(v) => !v && setMode(null)} pending={pending}
        tone={mode === "approve" ? "gold" : "danger"}
        title={mode === "approve" ? "申請を承認しますか？" : mode === "reject" ? "申請を却下しますか？" : "申請を取り下げますか？"}
        description={mode === "approve" ? "承認すると直ちに台帳・在庫に反映されます。" : undefined}
        confirmLabel={mode === "approve" ? "承認する" : mode === "reject" ? "却下する" : "取り下げる"}
        onConfirm={() => start(async () => {
          const r = mode === "withdraw" ? await withdraw(requestId) : await decide(requestId, mode === "approve", note);
          if (!r.ok) { setError(r.error.message); return; }
          setMode(null);
          router.refresh();
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        {mode !== "withdraw" && <Field label="コメント"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      </ConfirmDialog>
    </div>
  );
}
