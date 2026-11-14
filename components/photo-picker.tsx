"use client";
import * as React from "react";
import { Camera, ImagePlus, X } from "lucide-react";

/** 写真選択（カメラ撮影・複数選択）。プレビューを表示し、ファイル配列を親に返す */
export function PhotoPicker({ files, onChange, max = 20 }: { files: File[]; onChange: (f: File[]) => void; max?: number }) {
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const libraryRef = React.useRef<HTMLInputElement>(null);
  const urls = React.useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  React.useEffect(() => () => urls.forEach((x) => URL.revokeObjectURL(x)), [urls]);

  function add(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    onChange([...files, ...imgs].slice(0, max));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={u} className="relative size-20 overflow-hidden rounded-lg border border-border bg-navy-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt={`写真${i + 1}`} className="size-full object-cover" />
            <button
              type="button"
              aria-label={`写真${i + 1}を削除`}
              onClick={() => onChange(files.filter((_, k) => k !== i))}
              className="absolute top-1 right-1 rounded-full bg-navy-950/70 p-0.5 text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        {files.length < max && (
          <>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-navy-200 text-xs font-semibold text-navy-600 hover:bg-navy-50"
            >
              <Camera className="size-6" /> 撮影
            </button>
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-navy-200 text-xs font-semibold text-navy-600 hover:bg-navy-50"
            >
              <ImagePlus className="size-6" /> 選択
            </button>
          </>
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <p className="mt-1 text-xs text-muted">{files.length}/{max}枚（自動で圧縮して非公開保存）</p>
    </div>
  );
}
