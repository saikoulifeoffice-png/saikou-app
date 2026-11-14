"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Textarea } from "@/components/ui/input";
import { voidGoldPurchase } from "../actions";

export function VoidButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><XCircle className="text-negative" /> 取消</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} tone="danger" title="この買取を取消しますか？" confirmLabel="取消する" pending={pending}
        description="集計から除外されます。記録は削除されず、取消履歴として残ります。"
        onConfirm={() => start(async () => {
          const r = await voidGoldPurchase(id, reason);
          if (!r.ok) return setError(r.error.message);
          setOpen(false);
          router.refresh();
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <Field label="取消理由" required><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </>
  );
}
