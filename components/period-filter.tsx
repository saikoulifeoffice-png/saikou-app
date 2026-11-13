"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { presetRange, type PeriodPreset } from "@/lib/date";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "this_week", label: "今週" },
  { key: "this_month", label: "今月" },
  { key: "last_month", label: "先月" },
  { key: "this_year", label: "今年" },
];

/** 期間指定（URL の from/to/grain を更新） */
export function PeriodFilter({ from, to, grain, showGrain = false }: { from: string; to: string; grain?: string; showGrain?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) sp.set(k, v);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-x-auto rounded-lg border border-border bg-surface p-0.5">
        {PRESETS.map((p) => {
          const r = presetRange(p.key);
          const active = r.from === from && r.to === to;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => update(r)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap",
                active ? "bg-navy-700 text-white" : "text-muted hover:text-navy-700",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        <Input type="date" aria-label="開始日" value={from} max={to} onChange={(e) => e.target.value && update({ from: e.target.value })} className="h-9 w-[9.5rem]" />
        <span className="text-muted">〜</span>
        <Input type="date" aria-label="終了日" value={to} min={from} onChange={(e) => e.target.value && update({ to: e.target.value })} className="h-9 w-[9.5rem]" />
      </div>
      {showGrain && (
        <Select aria-label="集計単位" value={grain ?? "day"} onChange={(e) => update({ grain: e.target.value })} className="h-9 w-24">
          <option value="day">日別</option>
          <option value="week">週別</option>
          <option value="month">月別</option>
          <option value="year">年別</option>
        </Select>
      )}
    </div>
  );
}
