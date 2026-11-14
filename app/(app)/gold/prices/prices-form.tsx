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
import { parsePastedPrices } from "@/lib/gold/paste";
import { ClipboardPaste, Copy, ExternalLink } from "lucide-react";
import { Textarea } from "@/components/ui/input";

export const GOLDMRS_URL = "https://goldmrs.jp/";

export function PricesForm({ date, today, grades, defaultSourceName, existing, previous }: {
  date: string;
  today: string;
  grades: { code: string; label: string; metal: string }[];
  defaultSourceName: string;
  existing: { grade_code: string; unit_price: string; source_name: string; source_url: string | null; fetched_at: string; note: string | null }[];
  previous: { date: string; prices: Record<string, string> } | null;
}) {
  const router = useRouter();
  const first = existing[0];
  const [values, setValues] = React.useState<Record<string, string>>(Object.fromEntries(existing.map((e) => [e.grade_code, e.unit_price])));
  const [sourceName, setSourceName] = React.useState(first?.source_name ?? defaultSourceName);
  const [sourceUrl, setSourceUrl] = React.useState(first?.source_url ?? GOLDMRS_URL);
  const [paste, setPaste] = React.useState("");
  const [pasteInfo, setPasteInfo] = React.useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = React.useState(first ? toJstLocalInput(new Date(first.fetched_at)) : toJstLocalInput());
  const [note, setNote] = React.useState(first?.note ?? "");
  const [open, setOpen] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = React.useTransition();

  const entries = grades.map((g) => ({ g, raw: values[g.code] ?? "", v: parseHundredths(values[g.code] ?? "") }));
  const filled = entries.filter((e) => e.raw.trim() !== "");
  const invalid = filled.filter((e) => e.v === null);
  const changed = filled.filter((e) => existing.find((x) => x.grade_code === e.g.code)?.unit_price !== e.raw);
  // 前回相場から20%以上変動している品位（読み取り誤り・桁違いの検出用）
  const deviations = filled.filter((e) => {
    const prev = previous ? parseHundredths(previous.prices[e.g.code] ?? "") : null;
    return prev && e.v && Math.abs(e.v - prev) * 5 > prev;
  });

  function readPaste() {
    const r = parsePastedPrices(paste);
    const codes = Object.keys(r.prices).filter((c) => grades.some((g) => g.code === c));
    if (codes.length === 0) {
      setPasteInfo("品位と価格を読み取れませんでした。表の部分をコピーして貼り付けるか、直接入力してください。");
      return;
    }
    setValues({ ...values, ...Object.fromEntries(codes.map((c) => [c, r.prices[c]])) });
    setPasteInfo(`${codes.length}件を読み取りました（${codes.join("・")}）。内容を確認してから保存してください。`);
  }

  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="space-y-3 rounded-lg border border-gold-200 bg-gold-50 p-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="gold" asChild>
            <a href={GOLDMRS_URL} target="_blank" rel="noopener noreferrer"><ExternalLink /> ゴールドミセスの相場を開く</a>
          </Button>
          {previous && (
            <Button type="button" variant="outline" onClick={() => { setValues({ ...previous.prices, ...Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "")) }); setPasteInfo(`${previous.date} の相場をコピーしました。変わった品位だけ修正してください。`); }}>
              <Copy /> 前回（{previous.date}）の相場をコピー
            </Button>
          )}
        </div>
        <Field label="相場表を貼り付けて読み取る（任意）" hint="サイトの相場表を選択してコピーし、ここに貼り付けて「読み取る」を押すと単価を自動入力します">
          <Textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"例:\nK24 21,500円\nK18 16,500円\nPt900 4,800円"} />
        </Field>
        <Button type="button" variant="outline" size="sm" onClick={readPaste} disabled={!paste.trim()}><ClipboardPaste /> 読み取る</Button>
        {pasteInfo && <p className="text-sm text-navy-700" role="status">{pasteInfo}</p>}
      </div>
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
      {deviations.length > 0 && (
        <Alert tone="warning" title="前回の相場から20%以上変わっている品位があります">
          {deviations.map((e) => `${e.g.code}: ${formatHundredths(parseHundredths(previous!.prices[e.g.code]))} → ${formatHundredths(e.v)}円/g`).join("、")}。
          1gあたりの単価か（10gあたり等ではないか）確認してください。
        </Alert>
      )}
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
