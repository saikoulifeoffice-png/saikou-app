"use client";
import { useActionState } from "react";
import { changePassword, type PasswordState } from "./actions";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.ok && <Alert tone="success">パスワードを変更しました</Alert>}
      <Field label="現在のパスワード" htmlFor="current">
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="新しいパスワード" htmlFor="password" hint="10文字以上・英字と数字を含む">
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="新しいパスワード（確認）" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "変更中…" : "変更する"}</Button>
    </form>
  );
}
