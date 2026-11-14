"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Plus, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoPicker } from "@/components/photo-picker";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/input";
import { YenInput } from "@/components/yen-input";
import { formatYen } from "@/lib/money";
import { uploadItemPhotos } from "@/lib/photos-client";
import { removeItemPhoto } from "@/app/(app)/purchases/actions";
import { splitItem } from "../actions";
import { cn } from "@/lib/utils";

export function ItemPhotos({ itemId, canEdit, photos }: { itemId: string; canEdit: boolean; photos: { id: string; url?: string }[] }) {
  const router = useRouter();
  const [active, setActive] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const [files, setFiles] = React.useState<File[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [removeId, setRemoveId] = React.useState<string | null>(null);
  const current = photos[active];

  return (
    <div className="space-y-3">
      <div className="aspect-square overflow-hidden rounded-xl bg-navy-50 sm:aspect-[4/3]">
        {current?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.url} alt={`商品写真${active + 1}`} className="size-full object-contain" />
        ) : (
          <div className="grid size-full place-items-center text-navy-200"><div className="text-center"><ImageOff className="mx-auto size-10" /><p className="mt-2 text-sm">写真がありません</p></div></div>
        )}
      </div>
      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <div key={p.id} className="relative shrink-0">
              <button type="button" onClick={() => setActive(i)} className={cn("size-16 overflow-hidden rounded-lg border-2", i === active ? "border-gold-400" : "border-transparent")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.url && <img src={p.url} alt={`サムネイル${i + 1}`} className="size-full object-cover" />}
              </button>
              {canEdit && (
                <button type="button" aria-label="写真を削除" onClick={() => setRemoveId(p.id)} className="absolute -top-1 -right-1 rounded-full bg-surface p-1 text-negative shadow">
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && !adding && <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus /> 写真を追加</Button>}
      {adding && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <PhotoPicker files={files} onChange={setFiles} />
          {status && <Alert tone="info">{status}</Alert>}
          <div className="flex gap-2">
            <Button size="sm" disabled={!files.length || pending} onClick={() => start(async () => {
              const r = await uploadItemPhotos(itemId, files, (d, t) => setStatus(`アップロード中 ${d}/${t}`));
              setStatus(r.failed.length ? `${r.failed.length}枚の保存に失敗しました` : null);
              setFiles([]);
              setAdding(false);
              router.refresh();
            })}>{pending ? "保存中…" : "保存"}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setFiles([]); }}>キャンセル</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)} title="写真を削除しますか？" tone="danger" confirmLabel="削除"
        description="一覧から非表示になります（削除履歴は保存されます）" pending={pending}
        onConfirm={() => start(async () => { if (removeId) await removeItemPhoto(removeId, itemId); setRemoveId(null); setActive(0); router.refresh(); })} />
    </div>
  );
}

export function SplitItemButton({ itemId, cost, name }: { itemId: string; cost: number; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState([{ name, cost: null as number | null }, { name: "", cost: null as number | null }]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [key] = React.useState(() => crypto.randomUUID());
  const sum = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Scissors /> セットを分割</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title="セット商品の分割" confirmLabel="分割する" pending={pending}
        description={`原価合計 ${formatYen(cost)} を各商品に配分してください。分割後は個別に販売できます。`}
        onConfirm={() => start(async () => {
          if (sum !== cost) { setError(`原価合計を ${formatYen(cost)} にしてください（現在 ${formatYen(sum)}）`); return; }
          const r = await splitItem({ item_id: itemId, idempotency_key: key, children: rows.map((x) => ({ name: x.name, quantity: 1, cost_incl: x.cost ?? 0 })) });
          if (!r.ok) { setError(r.error.message); return; }
          setOpen(false);
          router.refresh();
        })}>
        {error && <Alert tone="error" className="mb-3">{error}</Alert>}
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-end gap-2">
              <Field label={`商品${i + 1}`}><Input value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} /></Field>
              <Field label="原価"><YenInput value={r.cost} onChange={(v) => setRows(rows.map((x, k) => (k === i ? { ...x, cost: v } : x)))} aria-label={`商品${i + 1}の原価`} /></Field>
              <Button variant="ghost" size="icon" aria-label="行を削除" disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, k) => k !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", cost: null }])}><Plus /> 行を追加</Button>
          <p className={cn("num text-right text-sm", sum === cost ? "text-positive" : "text-negative")}>合計 {formatYen(sum)} / {formatYen(cost)}</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
