"use client";
import * as React from "react";
import Link from "next/link";
import { useFieldArray, useForm, Controller } from "react-hook-form";
import { CheckCircle2, ChevronDown, Copy, Plus, Search, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { YenInput } from "@/components/yen-input";
import { PhotoPicker } from "@/components/photo-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Yen } from "@/components/yen";
import { allocate, formatYen, TAX_CATEGORY_LABELS, type TaxCategory } from "@/lib/money";
import { fromJstLocalInput, toJstLocalInput } from "@/lib/date";
import { CONDITION_LABELS, PAYMENT_METHOD_LABELS, PURCHASE_METHOD_LABELS } from "@/lib/labels";
import { purchaseSchema, VERIFICATION_METHODS, type PurchaseInput } from "@/lib/validation/purchase";
import { findCustomers, registerPurchase, type PurchaseResult } from "../actions";
import { uploadItemPhotos } from "@/lib/photos-client";
import { cn } from "@/lib/utils";

interface ItemForm {
  category_id: string;
  brand: string;
  name: string;
  model_no: string;
  serial_no: string;
  condition: "new" | "S" | "A" | "B" | "C" | "D" | "junk";
  quantity: number;
  cost_incl: number | null;
  tax_category: TaxCategory;
  storage_location: string;
  note: string;
  photos: File[];
}

interface FormValues {
  purchased_at: string;
  staff_id: string;
  customer_mode: "none" | "existing" | "new";
  customer_id: string;
  search_phone: string;
  customer_name: string;
  customer_kana: string;
  customer_phone: string;
  identity_enabled: boolean;
  identity: {
    verification_method: (typeof VERIFICATION_METHODS)[number];
    address: string;
    birth_date: string;
    occupation: string;
    id_document_number: string;
    note: string;
  };
  method: "store" | "visit" | "delivery" | "other";
  payment_method: "cash" | "bank_transfer" | "other";
  note: string;
  items: ItemForm[];
}

export interface PurchaseFormProps {
  me: { id: string; name: string; isManager: boolean };
  categories: { id: string; name: string }[];
  staff: { id: string; name: string; balance: number }[];
  myBalance: number;
}

function emptyItem(categoryId: string, location = ""): ItemForm {
  return {
    category_id: categoryId,
    brand: "",
    name: "",
    model_no: "",
    serial_no: "",
    condition: "A",
    quantity: 1,
    cost_incl: null,
    tax_category: "standard_10",
    storage_location: location,
    note: "",
    photos: [],
  };
}

export function PurchaseForm({ me, categories, staff, myBalance }: PurchaseFormProps) {
  const defaults = React.useMemo<FormValues>(
    () => ({
      purchased_at: toJstLocalInput(),
      staff_id: me.id,
      customer_mode: "none",
      customer_id: "",
      search_phone: "",
      customer_name: "",
      customer_kana: "",
      customer_phone: "",
      identity_enabled: false,
      identity: { verification_method: "運転免許証", address: "", birth_date: "", occupation: "", id_document_number: "", note: "" },
      method: "store",
      payment_method: "cash",
      note: "",
      items: [emptyItem(categories[0]?.id ?? "")],
    }),
    [me.id, categories],
  );
  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, watch, setValue, getValues, reset } = form;
  const items = useFieldArray({ control, name: "items" });
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => crypto.randomUUID());
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [payload, setPayload] = React.useState<PurchaseInput | null>(null);
  const [result, setResult] = React.useState<PurchaseResult | null>(null);
  const [photoStatus, setPhotoStatus] = React.useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [candidates, setCandidates] = React.useState<{ id: string; name: string; name_kana: string | null }[] | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkTotal, setBulkTotal] = React.useState<number | null>(null);

  const watchedItems = watch("items");
  const total = watchedItems.reduce((a, i) => a + (i.cost_incl ?? 0), 0);
  const paymentMethod = watch("payment_method");
  const staffId = watch("staff_id");
  const customerMode = watch("customer_mode");
  const identityEnabled = watch("identity_enabled");
  const balance = me.isManager ? (staff.find((s) => s.id === staffId)?.balance ?? 0) : myBalance;
  const insufficient = paymentMethod === "cash" && total > balance;

  function buildPayload(v: FormValues): PurchaseInput {
    return {
      idempotency_key: idempotencyKey,
      purchased_at: fromJstLocalInput(v.purchased_at),
      staff_id: me.isManager && v.staff_id !== me.id ? v.staff_id : undefined,
      customer_id: v.customer_mode === "existing" ? v.customer_id || undefined : undefined,
      customer_phone: v.customer_mode === "existing" ? v.search_phone : undefined,
      customer:
        v.customer_mode === "new"
          ? { name: v.customer_name, name_kana: v.customer_kana, phone: v.customer_phone || undefined }
          : undefined,
      method: v.method,
      payment_method: v.payment_method,
      note: v.note,
      identity: v.identity_enabled ? v.identity : undefined,
      items: v.items.map((i) => ({
        category_id: i.category_id,
        brand: i.brand,
        name: i.name,
        model_no: i.model_no,
        serial_no: i.serial_no,
        condition: i.condition,
        quantity: Number(i.quantity) || 0,
        cost_incl: i.cost_incl as number,
        tax_category: i.tax_category,
        storage_location: i.storage_location,
        note: i.note,
      })),
      total_incl: v.items.reduce((a, i) => a + (i.cost_incl ?? 0), 0),
    };
  }

  function onReview() {
    setServerError(null);
    const v = getValues();
    const p = buildPayload(v);
    const parsed = purchaseSchema.safeParse(p);
    const errs: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!errs[key]) errs[key] = issue.message;
      }
    }
    if (v.customer_mode === "existing" && !v.customer_id) errs["customer_id"] = "顧客を選択してください";
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setServerError("入力内容を確認してください");
      requestAnimationFrame(() => document.querySelector("[aria-invalid=true]")?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setPayload(p);
    setConfirmOpen(true);
  }

  function onConfirm() {
    if (!payload) return;
    startTransition(async () => {
      const res = await registerPurchase(payload);
      if (!res.ok) {
        setServerError(res.error.message);
        setConfirmOpen(false);
        return;
      }
      setConfirmOpen(false);
      setResult(res.data);
      // 写真アップロード（取引登録後）
      const photoJobs = getValues("items")
        .map((it, idx) => ({ files: it.photos, item: res.data.items.find((x) => x.line_no === idx + 1) }))
        .filter((j) => j.item && j.files.length > 0);
      const totalPhotos = photoJobs.reduce((a, j) => a + j.files.length, 0);
      if (totalPhotos > 0 && !res.data.duplicate) {
        let done = 0;
        const failed: string[] = [];
        setPhotoStatus({ done, total: totalPhotos, failed });
        for (const job of photoJobs) {
          const r = await uploadItemPhotos(job.item!.id, job.files, () => {
            done++;
            setPhotoStatus({ done, total: totalPhotos, failed: [...failed] });
          });
          failed.push(...r.failed.map((f) => `${job.item!.item_no}: ${f}`));
        }
        setPhotoStatus({ done, total: totalPhotos, failed });
      }
      window.scrollTo({ top: 0 });
    });
  }

  function startNew() {
    reset({ ...defaults, purchased_at: toJstLocalInput(), staff_id: getValues("staff_id") });
    setIdempotencyKey(crypto.randomUUID());
    setResult(null);
    setPhotoStatus(null);
    setErrors({});
    setServerError(null);
    setCandidates(null);
  }

  async function searchCustomer() {
    const phone = getValues("search_phone");
    const res = await findCustomers(phone);
    setCandidates(res.ok ? res.data : []);
  }

  function applyBulk() {
    if (bulkTotal === null) return;
    const qty = getValues("items").map((i) => Math.max(1, Number(i.quantity) || 1));
    const shares = allocate(bulkTotal, qty);
    shares.forEach((s, i) => setValue(`items.${i}.cost_incl`, s));
    setBulkOpen(false);
  }

  const err = (k: string) => errors[k];

  if (result) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={result.duplicate ? "この買取は既に登録済みです（二重送信を防止しました）" : "買取を登録しました"}>
          買取番号 <span className="num font-bold">{result.purchase_no}</span> ／ 合計 <Yen value={result.total_incl} className="font-bold" />
        </Alert>
        {photoStatus && (
          <Alert tone={photoStatus.failed.length ? "warning" : photoStatus.done < photoStatus.total ? "info" : "success"}
            title={photoStatus.done < photoStatus.total ? `写真をアップロード中… ${photoStatus.done}/${photoStatus.total}` : `写真 ${photoStatus.total - photoStatus.failed.length}/${photoStatus.total}枚を保存しました`}>
            {photoStatus.failed.length > 0 && <>保存できなかった写真があります。商品詳細から追加してください: {photoStatus.failed.join("、")}</>}
          </Alert>
        )}
        <Card>
          <CardHeader><CardTitle>登録した商品</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {result.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between py-2.5">
                  <span className="num font-semibold">{it.item_no}</span>
                  <Link href={`/items/${it.id}`} className="text-sm font-semibold text-navy-600 hover:underline">詳細</Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" variant="gold" onClick={startNew}><Plus /> 続けて買取登録</Button>
          <Button size="lg" variant="outline" asChild><Link href={`/purchases/${result.purchase_id}`}>買取取引を見る</Link></Button>
          <Button size="lg" variant="outline" asChild><Link href="/items">在庫一覧へ</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onReview(); }} className="space-y-4 pb-32 lg:pb-24" noValidate>
      {serverError && <Alert tone="error">{serverError}</Alert>}

      <Card>
        <CardHeader><CardTitle>取引情報</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="買取日時" htmlFor="purchased_at" required error={err("purchased_at")}>
            <Input id="purchased_at" type="datetime-local" {...register("purchased_at")} />
          </Field>
          {me.isManager ? (
            <Field label="買取担当者" htmlFor="staff_id" required hint="実績はこの担当者に帰属します">
              <Select id="staff_id" {...register("staff_id")}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}（準備金 {formatYen(s.balance)}）</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="買取担当者"><Input value={me.name} disabled /></Field>
          )}
          <Field label="買取方法" htmlFor="method" required>
            <Select id="method" {...register("method")}>
              {Object.entries(PURCHASE_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="支払方法" htmlFor="payment_method" required
            hint={paymentMethod === "cash" ? "担当者の買取準備金から支払います" : "会社口座から支払います（準備金は減りません）"}>
            <Select id="payment_method" {...register("payment_method")}>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>顧客情報</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-navy-50 p-1 text-sm font-semibold">
            {([["none", "記録しない"], ["existing", "既存顧客"], ["new", "新規顧客"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setValue("customer_mode", k)}
                className={cn("rounded-md py-2", customerMode === k ? "bg-surface text-navy-800 shadow-sm" : "text-muted")}>{l}</button>
            ))}
          </div>
          {customerMode === "existing" && (
            <div className="space-y-2">
              <Field label="電話番号で検索" htmlFor="search_phone" error={err("customer_id")} hint="電話番号の完全一致で検索します">
                <div className="flex gap-2">
                  <Input id="search_phone" inputMode="tel" placeholder="090-1234-5678" {...register("search_phone")} aria-invalid={!!err("customer_id") || undefined} />
                  <Button type="button" variant="outline" onClick={searchCustomer}><Search /> 検索</Button>
                </div>
              </Field>
              {candidates && candidates.length === 0 && <p className="text-sm text-muted">該当する顧客がいません。新規顧客として登録してください。</p>}
              {candidates?.map((c) => (
                <label key={c.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                  <input type="radio" value={c.id} {...register("customer_id")} />
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-sm text-muted">{c.name_kana}</span>
                </label>
              ))}
            </div>
          )}
          {customerMode === "new" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="氏名" htmlFor="customer_name" required error={err("customer.name")}>
                <Input id="customer_name" {...register("customer_name")} aria-invalid={!!err("customer.name") || undefined} />
              </Field>
              <Field label="フリガナ" htmlFor="customer_kana"><Input id="customer_kana" {...register("customer_kana")} /></Field>
              <Field label="電話番号" htmlFor="customer_phone" error={err("customer.phone")}>
                <Input id="customer_phone" inputMode="tel" {...register("customer_phone")} />
              </Field>
            </div>
          )}
          {customerMode !== "none" && (
            <div className="rounded-lg border border-border">
              <label className="flex cursor-pointer items-center gap-3 px-3 py-3">
                <input type="checkbox" {...register("identity_enabled")} className="size-4" />
                <ShieldCheck className="size-5 text-navy-500" />
                <span className="flex-1 text-sm font-semibold">本人確認記録を保存する（暗号化）</span>
                <ChevronDown className={cn("size-4 text-muted transition-transform", identityEnabled && "rotate-180")} />
              </label>
              {identityEnabled && (
                <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
                  <Alert tone="warning" className="sm:col-span-2">
                    古物営業法上の記録事項・本人確認方法・保存期間は現行法令と所轄警察の指導に基づき確認してください。本システムは適法性を保証しません。
                  </Alert>
                  <Field label="確認方法" htmlFor="vm" required>
                    <Select id="vm" {...register("identity.verification_method")}>
                      {VERIFICATION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </Select>
                  </Field>
                  <Field label="生年月日" htmlFor="birth" error={err("identity.birth_date")}>
                    <Input id="birth" type="date" {...register("identity.birth_date")} />
                  </Field>
                  <Field label="住所" htmlFor="address" className="sm:col-span-2"><Input id="address" {...register("identity.address")} /></Field>
                  <Field label="職業" htmlFor="occupation"><Input id="occupation" {...register("identity.occupation")} /></Field>
                  <Field label="証明書番号" htmlFor="docno" error={err("identity.id_document_number")} hint="マイナンバー（個人番号）は記録しないでください">
                    <Input id="docno" {...register("identity.id_document_number")} aria-invalid={!!err("identity.id_document_number") || undefined} />
                  </Field>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-navy-800">商品（{items.fields.length}点）</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setBulkOpen((v) => !v)}><Wand2 /> 一括金額を按分</Button>
      </div>
      {bulkOpen && (
        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="一括買取の合計金額" className="flex-1" hint="数量の比率で各商品に配分します（配分後に個別修正できます）">
              <YenInput value={bulkTotal} onChange={setBulkTotal} aria-label="一括買取の合計金額" />
            </Field>
            <Button type="button" onClick={applyBulk} disabled={bulkTotal === null}>配分する</Button>
          </CardContent>
        </Card>
      )}

      {items.fields.map((field, idx) => {
        const p = `items.${idx}`;
        return (
          <Card key={field.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Badge tone="gold">#{idx + 1}</Badge>商品</CardTitle>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon" aria-label="この商品を複製"
                  onClick={() => items.insert(idx + 1, { ...getValues(`items.${idx}`), serial_no: "", photos: [] })}><Copy /></Button>
                {items.fields.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" aria-label="この商品を削除" onClick={() => items.remove(idx)}><Trash2 className="text-negative" /></Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-6">
              <Field label="商品名" required error={err(`${p}.name`)} className="sm:col-span-4">
                <Input {...register(`items.${idx}.name`)} placeholder="例: サブマリーナ デイト" aria-invalid={!!err(`${p}.name`) || undefined} />
              </Field>
              <Field label="買取金額（税込）" required error={err(`${p}.cost_incl`)} className="sm:col-span-2">
                <Controller control={control} name={`items.${idx}.cost_incl`}
                  render={({ field: f }) => <YenInput value={f.value} onChange={f.onChange} invalid={!!err(`${p}.cost_incl`)} aria-label={`商品${idx + 1}の買取金額`} />} />
              </Field>
              <Field label="カテゴリー" required className="sm:col-span-2">
                <Select {...register(`items.${idx}.category_id`)}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="ブランド" className="sm:col-span-2"><Input {...register(`items.${idx}.brand`)} /></Field>
              <Field label="状態" required className="sm:col-span-2">
                <Select {...register(`items.${idx}.condition`)}>
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="型番" className="sm:col-span-2"><Input {...register(`items.${idx}.model_no`)} /></Field>
              <Field label="製造番号" className="sm:col-span-2"><Input {...register(`items.${idx}.serial_no`)} /></Field>
              <Field label="数量" required error={err(`${p}.quantity`)} className="sm:col-span-1">
                <Input type="number" inputMode="numeric" min={1} {...register(`items.${idx}.quantity`, { valueAsNumber: true })} />
              </Field>
              <Field label="税区分" className="sm:col-span-1">
                <Select {...register(`items.${idx}.tax_category`)}>
                  {Object.entries(TAX_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="保管場所" className="sm:col-span-2"><Input {...register(`items.${idx}.storage_location`)} placeholder="例: 本店金庫A" /></Field>
              <Field label="備考" className="sm:col-span-4"><Input {...register(`items.${idx}.note`)} /></Field>
              <div className="sm:col-span-6">
                <p className="mb-1.5 text-sm font-semibold">商品写真</p>
                <Controller control={control} name={`items.${idx}.photos`}
                  render={({ field: f }) => <PhotoPicker files={f.value} onChange={f.onChange} />} />
              </div>
            </CardContent>
          </Card>
        );
      })}
      <Button type="button" variant="outline" size="lg" className="w-full border-dashed"
        onClick={() => items.append(emptyItem(categories[0]?.id ?? "", getValues(`items.${items.fields.length - 1}.storage_location`)))}>
        <Plus /> 商品を追加
      </Button>

      <Card>
        <CardContent>
          <Field label="取引の備考" htmlFor="note"><Textarea id="note" rows={2} {...register("note")} /></Field>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">買取合計（{watchedItems.length}点）</p>
            <p className="num text-2xl font-bold text-navy-900">{formatYen(total)}</p>
            {paymentMethod === "cash" && (
              <p className={cn("num text-xs", insufficient ? "font-semibold text-negative" : "text-muted")}>
                準備金 {formatYen(balance)} → {formatYen(balance - total)}{insufficient && "（不足）"}
              </p>
            )}
          </div>
          <Button type="submit" variant="gold" size="lg" disabled={pending}>
            確認へ
          </Button>
        </div>
      </div>

      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="買取内容の確認" confirmLabel="この内容で登録" tone="gold" pending={pending} onConfirm={onConfirm}
        description="登録後の修正・取消は承認制です。内容をご確認ください。">
        {payload && (
          <div className="space-y-3 text-sm">
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {payload.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-3 px-3 py-2">
                  <span className="truncate">{i.name}{i.quantity > 1 && ` ×${i.quantity}`}</span>
                  <Yen value={i.cost_incl} className="font-semibold" />
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between rounded-lg bg-navy-50 px-3 py-3">
              <span className="font-semibold">合計</span>
              <Yen value={payload.total_incl} className="text-xl font-bold" />
            </div>
            <p className="text-muted">
              支払: {PAYMENT_METHOD_LABELS[payload.payment_method]}
              {payload.payment_method === "cash" && <>（準備金残高 {formatYen(balance)} → {formatYen(balance - payload.total_incl)}）</>}
            </p>
            {insufficient && <Alert tone="error">準備金残高が不足しています。補充申請を行ってください。</Alert>}
            {!!payload.items.length && (
              <p className="flex items-center gap-1 text-xs text-muted"><CheckCircle2 className="size-3.5" />写真は登録後に自動でアップロードされます</p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </form>
  );
}
