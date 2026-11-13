import { cn } from "@/lib/utils";
import { formatYen } from "@/lib/money";

export function StatCard({
  label,
  value,
  unit = "yen",
  sub,
  highlight = false,
  tone = "none",
  text: textOverride,
}: {
  text?: string;
  label: string;
  value: number | null | undefined;
  unit?: "yen" | "count" | "text";
  sub?: React.ReactNode;
  highlight?: boolean;
  tone?: "none" | "auto";
}) {
  const text = textOverride ?? (
    value === null || value === undefined
      ? "—"
      : unit === "yen"
        ? formatYen(value).replace("円", "")
        : value.toLocaleString("ja-JP"));
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        highlight ? "border-navy-800 bg-navy-800 text-white" : "border-border bg-surface",
      )}
    >
      <p className={cn("text-xs font-semibold", highlight ? "text-gold-200" : "text-muted")}>{label}</p>
      <p
        className={cn(
          "num mt-1 text-2xl font-bold tracking-tight sm:text-[1.7rem]",
          tone === "auto" && typeof value === "number" && value < 0 && "text-negative",
        )}
      >
        {text}
        {unit === "yen" && value !== null && value !== undefined && <span className="ml-0.5 text-sm font-semibold">円</span>}
        {unit === "count" && value !== null && value !== undefined && <span className="ml-0.5 text-sm font-semibold">件</span>}
      </p>
      {sub && <div className={cn("mt-1 text-xs", highlight ? "text-navy-100" : "text-muted")}>{sub}</div>}
    </div>
  );
}
