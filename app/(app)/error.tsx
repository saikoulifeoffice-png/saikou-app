"use client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const m = /SAIKOU:[A-Z_]+:([\s\S]*)/.exec(error.message);
  return (
    <div className="mx-auto max-w-lg space-y-4 py-10">
      <Alert tone="error" title="画面を表示できませんでした">
        {m ? m[1] : "通信エラーまたは権限エラーが発生しました。時間をおいて再度お試しください。"}
        {error.digest && <p className="mt-1 text-xs opacity-70">エラーID: {error.digest}</p>}
      </Alert>
      <Button onClick={reset}>再読み込み</Button>
    </div>
  );
}
