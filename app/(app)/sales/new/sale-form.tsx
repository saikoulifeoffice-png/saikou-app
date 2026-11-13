"use client";
import * as React from "react";
import Link from "next/link";
import { Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { YenInput } from "@/components/yen-input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Yen } from "@/components/yen";
import { previewSale } from "@/lib/calc/profit";
import { formatMargin, formatYen, TAX_CATEGORY_LABELS, type TaxCategory } from "@/lib/money";
import { fromJstLocalInput, jstDateString, toJstLocalInput, addDays } from "@/lib/date";
import { CHANNEL_LABELS, EXPENSE_TYPE_LABELS } from "@/lib/labels";
import { saleSchema, type SaleInput } from "@/lib/validation/sale";
import { registerSale, searchSellable, type SellableItem } from "../actions";
import { cn } from "@/lib/utils";

type Channel = keyof typeof CHANNEL_LABELS;
interface Line {
  item: SellableItem;
  quantity: number;
  revenue: number | null;
  tax: TaxCategory;
}
interface Expense {
  type: "fee" | "shipping" | "other";
  amount: number | null;
  tax: TaxCategory;
}

export function SaleForm({
  me,
  staff,
  initialItem,
}: {
  me: { id: string; name: string; isManager: boolean };
  staff: { id: string; name: string }[];
  initialItem: SellableItem | null;
}) {
  const [key, setKey] = React.useState(() => crypto.randomUUID());
  const [soldAt, setSoldAt] = React.useState(toJstLocalInput());
  const [salesStaff, setSalesStaff] = React.useState(me.id);
  const [channel, setChannel] = React.useState<Channel>("store");
  const [buyer, setBuyer] = React.useState("");
  const [modeState, setMode] = React.useState<"manual" | "cost">("manual");
  const [totalRevenue, setTotalRevenue] = React.useState<number | null>(null);
  const [lines, setLines] = React.useState<Line[]>(initialItem ? [{ item: initialItem, quantity: 1, revenue: null, tax: "standard_10" }] : []);
  const [expenses, setExpenses] = React.useState<Expense[]>([
    { type: "fee", amount: null, tax: "standard_10" },
    { type: "shipping", amount: null, tax: "standard_10" },
  ]);
  const [expected, setExpected] = React.useState<number | null>(null);
  const [expectedTouched, setExpectedTouched] = React.useState(false);
  const [dueDate, setDueDate] = React.useState("");
  const [receivedNow, setReceivedNow] = React.useState(true);
  const [note, setNote] = React.useState("");
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SellableItem[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<SaleInput | null>(null);
  const [pending, start] = React.useTransition();
  const [done, setDone] = React.useState<{ sale_id: string; sale_no: string; duplicate: boolean } | null>(null);

  const hiddenCost = lines.some((l) => l.item.stock_cost === null);
  // 原価が非表示の商品を含む場合は按分モードを使わない
  const mode = hiddenCost ? "manual" : modeState;
  const lineCost = (l: Line) =>
    l.item.stock_cost === null
      ? null
      : l.quantity >= l.item.stock_quantity
        ? l.item.stock_cost
        : Math.floor((l.item.stock_cost * l.quantity) / l.item.stock_quantity);
  const preview = previewSale({
    mode,
    totalRevenue,
    lines: lines.map((l) => ({ cost: lineCost(l), revenue: l.revenue })),
    expenses: expenses.map((e) => e.amount ?? 0),
  });
  const revenueTotal = preview.lines.reduce((a, l) => a + l.revenue, 0);
  const expenseTotal = expenses.reduce((a, e) => a + (e.amount ?? 0), 0);
  const expectedValue = expectedTouched ? expected : revenueTotal;

  function changeChannel(c: Channel) {
    setChannel(c);
    if (c === "store") setReceivedNow(true);
    else {
      setReceivedNow(false);
      if (!dueDate) setDueDate(addDays(jstDateString(), 7));
    }
  }

  async function search() {
    setSearching(true);
    const r = await searchSellable(q);
    setResults(r.ok ? r.data.filter((it) => !lines.some((l) => l.item.id === it.id)) : []);
    setSearching(false);
  }

  function addItem(item: SellableItem) {
    setLines([...lines, { item, quantity: 1, revenue: null, tax: channel === "other" ? "standard_10" : "standard_10" }]);
    setResults((r) => r?.filter((x) => x.id !== item.id) ?? null);
  }

  function review() {
    setError(null);
    const input: SaleInput = {
      idempotency_key: key,
      sold_at: fromJstLocalInput(soldAt),
      sales_staff_id: me.isManager && salesStaff !== me.id ? salesStaff : undefined,
      channel,
      buyer_name: buyer,
      allocation: mode,
      total_revenue_incl: mode === "cost" ? (totalRevenue ?? undefined) : undefined,
      lines: lines.map((l) => ({ item_id: l.item.id, quantity: l.quantity, revenue_incl: mode === "manual" ? (l.revenue ?? undefined) : undefined, tax_category: l.tax })),
      expenses: expenses.filter((e) => (e.amount ?? 0) > 0).map((e) => ({ expense_type: e.type, amount_incl: e.amount as number, tax_category: e.tax })),
      expected_receipt_amount: expectedValue ?? undefined,
      payment_due_date: receivedNow ? undefined : dueDate,
      received_now: receivedNow,
      note,
    };
    const parsed = saleSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setConfirm(input);
  }

  function submit() {
    if (!confirm) return;
    start(async () => {
      const r = await registerSale(confirm);
      setConfirm(null);
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setDone(r.data);
      window.scrollTo({ top: 0 });
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={done.duplicate ? "この販売は既に登録済みです（二重送信を防止しました）" : "販売を登録しました"}>
          販売番号 <span className="num font-bold">{done.sale_no}</span>
        </Alert>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="gold" size="lg" onClick={() => { setDone(null); setLines([]); setKey(crypto.randomUUID()); setTotalRevenue(null); setExpenses(expenses.map((e) => ({ ...e, amount: null }))); setExpectedTouched(false); setBuyer(""); setNote(""); setSoldAt(toJstLocalInput()); }}>
            <Plus /> 続けて販売登録
          </Button>
          <Button variant="outline" size="lg" asChild><Link href={`/sales/${done.sale_id}`}>販売詳細を見る</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-36 lg:pb-24">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>販売情報</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-navy-50 p-1 sm:grid-cols-5">
            {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => (
              <button key={c} type="button" onClick={() => changeChannel(c)}
                className={cn("rounded-md py-2 text-xs font-semibold sm:text-sm", channel === c ? "bg-navy-700 text-white" : "text-muted")}>
                {CHANNEL_LABELS[c]}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="販売日時（売上計上日）" required><Input type="datetime-local" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} /></Field>
            {me.isManager ? (
              <Field label="販売担当者" hint="利益実績は各商品の買取担当者に帰属します">
                <Select value={salesStaff} onChange={(e) => setSalesStaff(e.target.value)}>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="販売担当者" hint="利益実績は各商品の買取担当者に帰属します"><Input value={me.name} disabled /></Field>
            )}
            <Field label="販売先"><Input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="例: ○○商会／落札者ID" /></Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>商品（{lines.length}点）</CardTitle>
          <div className="flex rounded-lg bg-navy-50 p-0.5 text-xs font-semibold">
            <button type="button" onClick={() => setMode("manual")} className={cn("rounded-md px-3 py-1.5", mode === "manual" ? "bg-surface shadow-sm" : "text-muted")}>個別金額</button>
            <button type="button" onClick={() => !hiddenCost && setMode("cost")} disabled={hiddenCost}
              title={hiddenCost ? "原価が非表示の商品を含むため利用できません" : undefined}
              className={cn("rounded-md px-3 py-1.5 disabled:opacity-40", mode === "cost" ? "bg-surface shadow-sm" : "text-muted")}>一括金額を按分</button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="在庫を検索（商品名・商品番号・型番）"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} aria-label="在庫検索" />
            <Button type="button" variant="outline" onClick={search} disabled={searching}><Search /> 検索</Button>
          </div>
          {results && (
            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted">
                検索結果 {results.length}件
                <button type="button" onClick={() => setResults(null)} aria-label="閉じる"><X className="size-4" /></button>
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {results.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">在庫が見つかりません</li>}
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => addItem(r)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-navy-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.brand && `${r.brand} `}{r.name}</p>
                        <p className="text-xs text-muted"><span className="num">{r.item_no}</span>・在庫{r.stock_quantity}・{r.is_mine ? "自分の買取" : r.staff_name}</p>
                      </div>
                      {r.stock_cost !== null && <span className="num text-xs text-muted">原価 {formatYen(r.stock_cost)}</span>}
                      <Plus className="size-4 text-navy-500" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mode === "cost" && (
            <Field label="販売合計金額（税込）" required hint="各商品の買取原価の比率で按分します">
              <YenInput value={totalRevenue} onChange={setTotalRevenue} aria-label="販売合計金額" />
            </Field>
          )}
          {lines.length === 0 && <p className="py-6 text-center text-sm text-muted">在庫を検索して商品を追加してください</p>}
          <ul className="space-y-3">
            {lines.map((l, i) => {
              const pv = preview.lines[i];
              return (
                <li key={l.item.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{l.item.brand && `${l.item.brand} `}{l.item.name}</p>
                      <p className="text-xs text-muted"><span className="num">{l.item.item_no}</span>・買取担当 {l.item.is_mine ? me.name : l.item.staff_name}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" aria-label="削除" onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 className="text-negative" /></Button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {mode === "manual" ? (
                      <Field label="販売金額（税込）" className="col-span-2 sm:col-span-1">
                        <YenInput value={l.revenue} onChange={(v) => setLines(lines.map((x, k) => (k === i ? { ...x, revenue: v } : x)))} aria-label={`${l.item.name}の販売金額`} />
                      </Field>
                    ) : (
                      <div className="col-span-2 sm:col-span-1"><p className="text-xs text-muted">按分後の売上</p><Yen value={pv?.revenue} className="text-lg font-semibold" /></div>
                    )}
                    <Field label="数量">
                      <Input type="number" min={1} max={l.item.stock_quantity} value={l.quantity} disabled={l.item.stock_quantity <= 1}
                        onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, quantity: Math.min(Math.max(1, Number(e.target.value) || 1), l.item.stock_quantity) } : x)))} />
                    </Field>
                    <Field label="税区分">
                      <Select value={l.tax} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, tax: e.target.value as TaxCategory } : x)))}>
                        {Object.entries(TAX_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </Field>
                    <div className="text-right text-xs">
                      <p className="text-muted">直接費 <span className="num">{formatYen(pv?.directExpense ?? 0)}</span></p>
                      {pv?.cost !== null && pv ? (
                        <>
                          <p className="text-muted">原価 <span className="num">{formatYen(pv.cost)}</span></p>
                          <p className={cn("num text-sm font-bold", (pv.profit ?? 0) < 0 ? "text-negative" : "text-positive")}>利益 {formatYen(pv.profit)}</p>
                        </>
                      ) : <p className="text-muted">原価非表示</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>販売直接費</CardTitle><span className="text-xs text-muted">売上比で各商品に配分</span></CardHeader>
        <CardContent className="space-y-3">
          {expenses.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[10rem_1fr_9rem_auto]">
              <Field label="種別">
                <Select value={e.type} onChange={(ev) => setExpenses(expenses.map((x, k) => (k === i ? { ...x, type: ev.target.value as Expense["type"] } : x)))}>
                  {Object.entries(EXPENSE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="金額（税込）">
                <YenInput value={e.amount} onChange={(v) => setExpenses(expenses.map((x, k) => (k === i ? { ...x, amount: v } : x)))} aria-label={`${EXPENSE_TYPE_LABELS[e.type]}の金額`} />
              </Field>
              <Field label="税区分" className="hidden sm:block">
                <Select value={e.tax} onChange={(ev) => setExpenses(expenses.map((x, k) => (k === i ? { ...x, tax: ev.target.value as TaxCategory } : x)))}>
                  {Object.entries(TAX_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label="削除" onClick={() => setExpenses(expenses.filter((_, k) => k !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setExpenses([...expenses, { type: "other", amount: null, tax: "standard_10" }])}><Plus /> 経費を追加</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>入金</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-3">
            <input type="checkbox" checked={receivedNow} onChange={(e) => setReceivedNow(e.target.checked)} className="size-4" />
            <span className="text-sm font-semibold">販売時に入金済み（現金・即時決済）</span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="入金予定額" hint={channel === "ec" || channel === "auction" ? "プラットフォーム手数料が差し引かれる場合は差引後の金額" : "既定は売上合計"}>
              <div className="flex gap-2">
                <YenInput value={expectedValue} onChange={(v) => { setExpectedTouched(true); setExpected(v); }} aria-label="入金予定額" />
                {(channel === "ec" || channel === "auction") && (
                  <Button type="button" variant="outline" size="sm" className="h-11 shrink-0"
                    onClick={() => { setExpectedTouched(true); setExpected(Math.max(0, revenueTotal - expenses.filter((e) => e.type === "fee").reduce((a, e) => a + (e.amount ?? 0), 0))); }}>
                    手数料差引
                  </Button>
                )}
              </div>
            </Field>
            {!receivedNow && <Field label="入金予定日"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
          </div>
          <Field label="備考"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="grid grid-cols-2 gap-x-4 text-xs sm:grid-cols-4">
            <div><p className="text-muted">売上</p><p className="num text-lg font-bold sm:text-xl">{formatYen(revenueTotal)}</p></div>
            <div><p className="text-muted">直接費</p><p className="num text-lg font-semibold">{formatYen(expenseTotal)}</p></div>
            {preview.summary && (
              <>
                <div><p className="text-muted">利益</p><p className={cn("num text-lg font-bold", preview.summary.netProfit < 0 ? "text-negative" : "text-positive")}>{formatYen(preview.summary.netProfit)}</p></div>
                <div className="hidden sm:block"><p className="text-muted">利益率</p><p className="num text-lg font-semibold">{formatMargin(preview.summary.marginBp)}</p></div>
              </>
            )}
          </div>
          <Button variant="gold" size="lg" onClick={review} disabled={lines.length === 0 || pending}>確認へ</Button>
        </div>
      </div>

      <ConfirmDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} title="販売内容の確認" tone="gold" confirmLabel="この内容で登録" pending={pending} onConfirm={submit}
        description="登録後のキャンセルは承認制です。返品は返品登録で処理します。">
        <div className="space-y-2 text-sm">
          <p><Badge>{CHANNEL_LABELS[channel]}</Badge> {buyer && <span className="ml-2">{buyer}</span>}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lines.map((l, i) => (
              <li key={l.item.id} className="flex justify-between gap-2 px-3 py-2">
                <span className="truncate">{l.item.name}{l.quantity > 1 && ` ×${l.quantity}`}</span>
                <Yen value={preview.lines[i]?.revenue} className="font-semibold" />
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-navy-50 p-3">
            <span>売上合計</span><Yen value={revenueTotal} className="text-right font-bold" />
            <span>販売直接費</span><Yen value={expenseTotal} className="text-right" />
            {preview.summary && <><span>利益</span><Yen value={preview.summary.netProfit} tone="auto" className="text-right font-bold" /></>}
            <span>入金</span><span className="text-right">{receivedNow ? "入金済み" : `予定 ${dueDate || "未定"}`}（{formatYen(expectedValue)}）</span>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
