"use client";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="ログインID または メールアドレス" htmlFor="email">
        <Input id="email" name="email" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required defaultValue={state.email} />
      </Field>
      <Field label="パスワード" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "ログイン中…" : "ログイン"}
      </Button>
    </form>
  );
}
