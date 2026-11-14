"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/input";
import { saveSettings } from "./actions";

type S = Parameters<typeof saveSettings>[0];

export function SettingsForm({ initial }: { initial: S }) {
  const [v, setV] = React.useState<S>(initial);
  const [open, setOpen] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = React.useTransition();
  return (
    <div className="grid gap-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label="画面モード" hint="簡易版: 貴金属買取（登録・履歴・相場・集計）のみ表示。全機能: 在庫・販売・資金管理も表示">
        <select className="flex h-11 w-full rounded-lg border border-border bg-surface px-3" value={v.ui_mode} onChange={(e) => setV({ ...v, ui_mode: e.target.value as S["ui_mode"] })}>
          <option value="simple">簡易版（貴金属買取のみ）</option><option value="full">全機能</option>
        </select>
      </Field>
      <Field label="参考相場の取得元名" hint="相場登録時の既定の取得元として記録されます">
        <Input value={v.pm_price_source_name} onChange={(e) => setV({ ...v, pm_price_source_name: e.target.value })} />
      </Field>
      <Field label="集計の税基準" hint="ダッシュボード・個人実績・ランキングすべてに適用（混在しません）">
        <Select value={v.tax_basis} onChange={(e) => setV({ ...v, tax_basis: e.target.value as S["tax_basis"] })}><option value="incl">税込</option><option value="excl">税抜</option></Select>
      </Field>
      <Field label="消費税の端数処理" hint="今後登録する取引に適用（要税理士確認）">
        <Select value={v.tax_rounding} onChange={(e) => setV({ ...v, tax_rounding: e.target.value as S["tax_rounding"] })}><option value="floor">切り捨て</option><option value="round">四捨五入</option><option value="ceil">切り上げ</option></Select>
      </Field>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={v.staff_can_view_other_inventory} onChange={(e) => setV({ ...v, staff_can_view_other_inventory: e.target.checked })} className="size-4" />従業員が他の担当者の在庫（原価を除く）を閲覧・販売できる</label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={v.admin_can_approve_funds} onChange={(e) => setV({ ...v, admin_can_approve_funds: e.target.checked })} className="size-4" />管理者に資金操作・資金承認を許可する</label>
      <Field label="本人確認記録の保存年数" hint="古物営業法上の保存期間は要確認（新規記録の保存期限に使用）">
        <Input type="number" min={1} max={30} value={v.identity_retention_years} onChange={(e) => setV({ ...v, identity_retention_years: Number(e.target.value) })} />
      </Field>
      <Field label="長期滞留とみなす日数"><Input type="number" min={1} value={v.long_stay_days} onChange={(e) => setV({ ...v, long_stay_days: Number(e.target.value) })} /></Field>
      <Button onClick={() => setOpen(true)} className="w-fit">保存</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="設定を保存しますか？" pending={pending} onConfirm={() => start(async () => {
        const r = await saveSettings(v);
        setOpen(false);
        setMsg(r.ok ? { tone: "success", text: "保存しました" } : { tone: "error", text: r.error.message });
      })} />
    </div>
  );
}
