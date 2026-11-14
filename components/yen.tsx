import { formatYen } from "@/lib/money";
import { cn } from "@/lib/utils";

/** 金額表示。tone=auto でプラス/マイナスを色分け */
export function Yen({
  value,
  className,
  tone = "none",
  sign = false,
}: {
  value: number | null | undefined;
  className?: string;
  tone?: "none" | "auto";
  sign?: boolean;
}) {
  return (
    <span
      className={cn(
        "num",
        tone === "auto" && typeof value === "number" && value < 0 && "text-negative",
        tone === "auto" && typeof value === "number" && value > 0 && "text-positive",
        className,
      )}
    >
      {formatYen(value, { sign })}
    </span>
  );
}
