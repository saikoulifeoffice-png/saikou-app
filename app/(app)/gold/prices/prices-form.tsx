"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/input";
import { formatHundredths, hundredthsToDecimal, parseHundredths } from "@/lib/gold/calc";
import { fromJstLocalInput, toJstLocalInput } from "@/lib/date";
import { saveMarketPrices } from "../actions";

export function PricesForm({ date, today, grades, defaultSourceName, existing }: {
  date: string;
  today: string;
  grades: { code: string; label: string; metal: string }[];
  defaultSourceName: string;
  existing: { grade_code: string; unit_price: string; source_name: string; source_url: string | null; fetched_at: string; note: string | null }[];
}) {
  const router = useRouter();
  const first = existing[0];
  const [values, setValues] = React.useState<Record<string, string>>(Object.fromEntries(existing.map((e) => [e.grade_code, e.unit_price])));
  const [sourceName, setSourceName] = React.useState(first?.source_name ?? defaultSourceName);
  const [sourceUrl, setSourceUrl] = React.useState(first?.source_url ?? "");
  const [fetchedAt, setFetchedAt] = React.useState(first ? toJstLocalInput(new Date(first.fetched_at)) : toJstLocalInput());
  const [note, setNote] = React.useState(first?.note ?? "");
  const [open, setOpen] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = React.useTransition();

  const entries = grades.map((g) => ({ g, raw: values[g.code] ?? "", v: parseHundredths(values[g.code] ?? "") }));
  const filled = entries.filter((e) => e.raw.trim() !== "");
  const invalid = filled.filter((e) => e.v === null);
  const changed = filled.filter((e) => existing.find((x) => x.grade_code === e.g.code)?.unit_price !== e.raw);

  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="相場の日付" required>
          <Input type="date" value={date} max={today} onChange={(e) => e.target.value && router.push(`/gold/prices?date=${e.target.value}`)} />
        </Field>
        <Field label="取得日時（相場を確認した日時）" required>
          <Input type="datetime-local" value={fetchedAt} onChange={(e) => setFetchedAt(e.target.value)} />
        </Field>
        <Field label="取得元" required><Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} /></Field>
        <Field label="取得元URL（任意）"><Input type="url" inputMode="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {entries.map(({ g, raw, v }) => (
          <Field key={g.code} label={g.label}>
            <div className="relative">
              <Input inputMode="decimal" value={raw} aria-label={`${g.code}の相場単価`} aria-invalid={(raw !== "" && v === null) || undefined}
                onChange={(e) => setValues({ ...values, [g.code]: e.target.value })} placeholder="未登録"
                className="num pr-11 text-right font-semibold" />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted">円/g</span>
            </div>
          </Field>
        ))}
      </div>
      <Field label="メモ"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {invalid.length > 0 && <Alert tone="error">{invalid.map((e) => e.g.code).join("・")} の単価が不正です（小数2桁まで）</Alert>}
      <Button onClick={() => setOpen(true)} disabled={filled.length === 0 || invalid.length > 0}>保存</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={`${date} の相場を保存しますか？`} pending={pending} confirmLabel="保存する"
        description="登録済みの買取記録の単価・金額は変わりません（登録時の単価を保存済み）。"
        onConfirm={() => start(async () => {
          const r = await saveMarketPrices({
            price_date: date, source_name: sourceName, source_url: sourceUrl, fetched_at: fromJstLocalInput(fetchedAt), note,
            prices: filled.map((e) => ({ grade_code: e.g.code, unit_price: hundredthsToDecimal(e.v!) })),
          });
          setOpen(false);
          setMsg(r.ok ? { tone: "success", text: `${r.data}件の相場を保存しました` } : { tone: "error", text: r.error.message });
          router.refresh();
        })}>
        <ul className="grid grid-cols-2 gap-1 text-sm">
          {filled.map((e) => (
            <li key={e.g.code} className="num">{e.g.code}: {formatHundredths(e.v)}円/g{changed.includes(e) && existing.length > 0 && " ●"}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
