"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { YenInput } from "@/components/yen-input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Yen } from "@/components/yen";
import { formatHundredths, hundredthsToDecimal, parseHundredths, summarizeGold } from "@/lib/gold/calc";
import { formatMargin, formatYen } from "@/lib/money";
import { formatDate, jstDateString } from "@/lib/date";
import { goldPurchaseSchema, type GoldPurchaseInput } from "@/lib/validation/gold";
import { getPricesForDate, registerGoldPurchase, type GoldPurchaseResult, type PriceForDate } from "../actions";
import { cn } from "@/lib/utils";

interface Line {
  key: string;
  item_name: string;
  grade_code: string;
  weight: string;
  price: string; // 入力中の文字列
  priceEdited: boolean;
}

export interface GoldFormProps {
  me: { id: string; name: string; isManager: boolean };
  staff: { id: string; name: string }[];
  grades: { code: string; label: string; metal: string }[];
  initialPrices: PriceForDate[];
  sourceName: string;
}

function newLine(grade = "K18"): Line {
  return { key: crypto.randomUUID(), item_name: "", grade_code: grade, weight: "", price: "", priceEdited: false };
}

export function GoldForm({ me, staff, grades, initialPrices, sourceName }: GoldFormProps) {
  const today = jstDateString();
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [date, setDate] = React.useState(today);
  const [staffId, setStaffId] = React.useState(me.id);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [paid, setPaid] = React.useState<number | null>(null);
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([newLine()]);
  const [prices, setPrices] = React.useState<PriceForDate[]>(initialPrices);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<GoldPurchaseInput | null>(null);
  const [pending, start] = React.useTransition();
  const [done, setDone] = React.useState<GoldPurchaseResult | null>(null);

  const priceOf = React.useCallback((code: string) => prices.find((p) => p.grade_code === code), [prices]);

  async function changeDate(d: string) {
    setDate(d);
    if (!d) return;
    const r = await getPricesForDate(d);
    if (r.ok) setPrices(r.data);
  }

  const effectivePrice = (l: Line): string => {
    if (l.priceEdited) return l.price;
    const p = priceOf(l.grade_code);
    return p ? String(p.unit_price) : "";
  };

  const parsed = lines.map((l) => ({ weight: parseHundredths(l.weight), price: parseHundredths(effectivePrice(l)) }));
  const summary = summarizeGold(parsed, paid);
  const missingGrades = [...new Set(lines.filter((l) => !l.priceEdited && !priceOf(l.grade_code)).map((l) => l.grade_code))];
  const oldPriceGrades = [...new Set(lines.filter((l) => !l.priceEdited && priceOf(l.grade_code) && !priceOf(l.grade_code)!.is_exact_date).map((l) => l.grade_code))];

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }

  function review() {
    setError(null);
    const input: GoldPurchaseInput = {
      idempotency_key: key,
      purchased_on: date,
      staff_id: me.isManager && staffId !== me.id ? staffId : undefined,
      customer_name: name,
      customer_phone: phone || undefined,
      customer_address: address,
      paid_amount: paid ?? -1,
      note,
      items: lines.map((l, i) => ({
        item_name: l.item_name,
        grade_code: l.grade_code,
        weight_g: parsed[i].weight ? hundredthsToDecimal(parsed[i].weight!) : l.weight,
        unit_price: parsed[i].price ? hundredthsToDecimal(parsed[i].price!) : undefined,
      })),
    };
    if (paid === null) return setError("お客様に支払った買取金額を入力してください");
    const bad = lines.findIndex((_, i) => !parsed[i].weight);
    if (bad >= 0) return setError(`${bad + 1}点目の重量を入力してください（小数2桁まで）`);
    const noPrice = lines.findIndex((_, i) => !parsed[i].price);
    if (noPrice >= 0) return setError(`${noPrice + 1}点目（${lines[noPrice].grade_code}）の相場単価がありません。相場を登録するか単価を入力してください`);
    const r = goldPurchaseSchema.safeParse(input);
    if (!r.success) return setError(r.error.issues[0].message);
    setConfirm(input);
  }

  function submit() {
    if (!confirm) return;
    start(async () => {
      const r = await registerGoldPurchase(confirm);
      setConfirm(null);
      if (!r.ok) return setError(r.error.message);
      setDone(r.data);
      window.scrollTo({ top: 0 });
    });
  }

  function reset() {
    setDone(null); setKey(crypto.randomUUID()); setName(""); setPhone(""); setAddress(""); setPaid(null); setNote("");
    setLines([newLine()]); setError(null);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={done.duplicate ? "この買取は登録済みです（二重送信を防止しました）" : "買取を登録しました"}>
          受付番号 <span className="num font-bold">{done.purchase_no}</span>
        </Alert>
        {done.warnings?.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}
        {!done.duplicate && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-muted">地金総額</p><Yen value={done.total_metal_value} className="text-2xl font-bold" /></div>
            <div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-muted">見込み利益</p><Yen value={done.expected_profit} tone="auto" className="text-2xl font-bold" /></div>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="gold" size="lg" onClick={reset}><Plus /> 続けて登録</Button>
          <Button variant="outline" size="lg" asChild><Link href={`/gold/${done.purchase_id}`}>登録内容を見る</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-40 lg:pb-28">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader><CardTitle>お客様・買取情報</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="お客様の名前" required htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="電話番号" htmlFor="phone">
            <Input id="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="090-1234-5678" autoComplete="off" />
          </Field>
          <Field label="住所" htmlFor="address" className="sm:col-span-2">
            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="買取日" required htmlFor="date">
            <Input id="date" type="date" value={date} max={today} onChange={(e) => changeDate(e.target.value)} />
          </Field>
          {me.isManager ? (
            <Field label="買取担当" htmlFor="staff">
              <Select id="staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="買取担当"><Input value={me.name} disabled /></Field>
          )}
        </CardContent>
      </Card>

      {missingGrades.length > 0 && (
        <Alert tone="warning" title="参考相場が未登録の品位があります">
          {missingGrades.join("・")} の {formatDate(date)} 以前の相場が登録されていません。代表・管理者が「相場管理」で登録するか、単価を手入力してください。
        </Alert>
      )}
      {oldPriceGrades.length > 0 && (
        <Alert tone="info">
          {oldPriceGrades.map((g) => `${g}: ${formatDate(priceOf(g)!.price_date)}`).join("、")} の相場を適用しています（買取日の相場が未登録のため）
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-navy-800">商品（{lines.length}点）</h2>
        <span className="text-xs text-muted">参考相場: {sourceName}</span>
      </div>

      {lines.map((l, i) => {
        const p = priceOf(l.grade_code);
        const value = summary.lineValues[i];
        return (
          <Card key={l.key}>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Badge tone="gold">#{i + 1}</Badge>
                {lines.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={`${i + 1}点目を削除`}>
                    <Trash2 className="text-negative" /> 削除
                  </Button>
                )}
              </div>
              <Field label="商品名（任意）">
                <Input value={l.item_name} onChange={(e) => update(i, { item_name: e.target.value })} placeholder="例: 喜平ネックレス" aria-label={`${i + 1}点目の商品名`} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="品位" required>
                  <Select value={l.grade_code} aria-label={`${i + 1}点目の品位`} onChange={(e) => update(i, { grade_code: e.target.value, priceEdited: false, price: "" })}>
                    {grades.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
                  </Select>
                </Field>
                <Field label="重量（g）" required>
                  <div className="relative">
                    <Input inputMode="decimal" value={l.weight} onChange={(e) => update(i, { weight: e.target.value })} placeholder="0.00"
                      aria-label={`${i + 1}点目の重量`} aria-invalid={(!!l.weight && !parsed[i].weight) || undefined}
                      className="num pr-7 text-right text-lg font-semibold sm:text-base" />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">g</span>
                  </div>
                </Field>
              </div>
              <Field label="参考相場単価（円/g）" hint={l.priceEdited ? "手入力" : p ? `${formatDate(p.price_date)} の相場${p.is_exact_date ? "" : "（買取日以前の直近）"}` : "相場未登録"}>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input inputMode="decimal" value={effectivePrice(l)} aria-label={`${i + 1}点目の相場単価`}
                      onChange={(e) => update(i, { price: e.target.value, priceEdited: true })}
                      aria-invalid={(!parsed[i].price) || undefined}
                      className={cn("num pr-12 text-right text-lg font-semibold sm:text-base", !l.priceEdited && "bg-navy-50")} />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">円/g</span>
                  </div>
                  {l.priceEdited && p && (
                    <Button type="button" variant="outline" className="h-11" onClick={() => update(i, { priceEdited: false, price: "" })}>相場に戻す</Button>
                  )}
                </div>
              </Field>
              <div className="flex items-center justify-between rounded-lg bg-navy-50 px-3 py-2">
                <span className="text-sm text-muted">地金金額</span>
                <span className="num text-xl font-bold text-navy-900">{value === null ? "—" : formatYen(value)}</span>
              </div>
              {!p && !l.priceEdited && <p className="flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3.5" />相場が未登録です</p>}
            </CardContent>
          </Card>
        );
      })}

      <Button type="button" variant="outline" size="lg" className="w-full border-dashed" onClick={() => setLines([...lines, newLine(lines[lines.length - 1]?.grade_code)])}>
        <Plus /> 商品を追加
      </Button>

      <Card>
        <CardContent className="space-y-4">
          <Field label="お客様に支払った買取金額" required htmlFor="paid">
            <YenInput id="paid" value={paid} onChange={setPaid} aria-label="お客様に支払った買取金額" />
          </Field>
          <Field label="備考" htmlFor="note"><Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="grid grid-cols-3 gap-x-3 text-xs">
            <div><p className="text-muted">地金総額</p><p className="num whitespace-nowrap text-sm font-bold sm:text-xl">{formatYen(summary.totalMetalValue)}</p></div>
            <div><p className="text-muted">見込み利益</p>
              <p className={cn("num whitespace-nowrap text-sm font-bold sm:text-xl", paid !== null && summary.expectedProfit < 0 && "text-negative", paid !== null && summary.expectedProfit > 0 && "text-positive")}>
                {paid === null ? "—" : formatYen(summary.expectedProfit)}</p></div>
            <div><p className="text-muted">利益率</p><p className="num whitespace-nowrap text-sm font-semibold sm:text-xl">{paid === null ? "—" : formatMargin(summary.marginBp)}</p></div>
          </div>
          <Button variant="gold" size="lg" onClick={review} disabled={pending}>確認</Button>
        </div>
      </div>

      <ConfirmDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} title="買取内容の確認" tone="gold" confirmLabel="登録する" pending={pending} onConfirm={submit}
        description="登録後は内容を変更できません（誤りは代表・管理者が取消して再登録）">
        <div className="space-y-3 text-sm">
          <p><span className="font-semibold">{name}</span> 様・{formatDate(date)}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lines.map((l, i) => (
              <li key={l.key} className="flex justify-between gap-2 px-3 py-2">
                <span className="truncate">{l.grade_code} {formatHundredths(parsed[i].weight)}g × {formatHundredths(parsed[i].price)}円{l.item_name && `（${l.item_name}）`}</span>
                <span className="num font-semibold">{formatYen(summary.lineValues[i])}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-y-1 rounded-lg bg-navy-50 p-3">
            <span>地金総額</span><Yen value={summary.totalMetalValue} className="text-right font-bold" />
            <span>支払額</span><Yen value={summary.paidAmount} className="text-right" />
            <span>見込み利益</span><Yen value={summary.expectedProfit} tone="auto" className="text-right font-bold" />
            <span>利益率</span><span className="num text-right">{formatMargin(summary.marginBp)}</span>
          </div>
          <p className="text-xs text-muted">※ 地金金額は参考相場による見込み額で、実際の売却価格ではありません。</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
