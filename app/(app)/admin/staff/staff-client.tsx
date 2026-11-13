"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/input";
import { createStaff, setActive, setRole } from "./actions";

type Role = "owner" | "admin" | "staff";

export function CreateStaffButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ display_name: "", email: "", password: "", role: "staff" as Role });
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}><UserPlus /> 従業員を追加</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="従業員アカウントの発行" confirmLabel="発行する" pending={pending}
        description="初期パスワードは本人に安全な方法で伝え、初回ログイン後に変更してもらってください。準備金口座は自動で作成されます。"
        onConfirm={() => start(async () => {
          const r = await createStaff(v);
          if (!r.ok) { setError(r.error.message); return; }
          setOpen(false); setV({ display_name: "", email: "", password: "", role: "staff" }); setError(null);
          router.refresh();
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <div className="grid gap-3">
          <Field label="氏名" required><Input value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></Field>
          <Field label="メールアドレス（ログインID）" required><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="off" /></Field>
          <Field label="初期パスワード" required hint="10文字以上・英字と数字を含む"><Input type="text" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="権限">
            <Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
              <option value="staff">従業員</option><option value="admin">管理者</option><option value="owner">代表</option>
            </Select>
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}

export function StaffRowActions({ id, name, role, active }: { id: string; name: string; role: Role; active: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState<{ kind: "role"; role: Role } | { kind: "active" } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <div className="flex gap-2">
      <Select aria-label={`${name}の権限`} className="h-9 w-28" value={role} onChange={(e) => setConfirm({ kind: "role", role: e.target.value as Role })} disabled={!active}>
        <option value="staff">従業員</option><option value="admin">管理者</option><option value="owner">代表</option>
      </Select>
      <Button size="sm" variant={active ? "outline" : "primary"} className="h-9" onClick={() => setConfirm({ kind: "active" })}>{active ? "無効化" : "有効化"}</Button>
      <ConfirmDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} pending={pending} tone={confirm?.kind === "active" && active ? "danger" : "primary"}
        title={confirm?.kind === "role" ? `${name} さんの権限を変更` : active ? `${name} さんを無効化` : `${name} さんを有効化`}
        description={confirm?.kind === "active" && active ? "ログインできなくなり、準備金口座も無効になります。データは保持されます。" : undefined}
        onConfirm={() => start(async () => {
          const r = confirm?.kind === "role" ? await setRole(id, confirm.role) : await setActive(id, !active);
          if (!r.ok) { setError(r.error.message); return; }
          setConfirm(null); router.refresh();
        })}>
        {error && <Alert tone="error">{error}</Alert>}
      </ConfirmDialog>
    </div>
  );
}
