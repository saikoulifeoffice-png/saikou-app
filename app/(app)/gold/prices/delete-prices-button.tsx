"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { deleteMarketPrices } from "../actions";

export function DeletePricesButton({ date }: { date: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-negative" onClick={() => setOpen(true)} aria-label={`${date}の相場を削除`}>
        <Trash2 /> 削除
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} tone="danger" pending={pending} title={`${date} の相場を削除しますか？`} confirmLabel="削除する"
        description="この日の全品位の相場が削除されます。登録済みの買取記録の単価・金額は変わりません。"
        onConfirm={() => start(async () => {
          const r = await deleteMarketPrices(date);
          if (!r.ok) return setError(r.error.message);
          setOpen(false);
          router.refresh();
        })}>
        {error && <Alert tone="error">{error}</Alert>}
      </ConfirmDialog>
    </>
  );
}
