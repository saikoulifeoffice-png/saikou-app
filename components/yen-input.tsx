"use client";
import * as React from "react";
import { parseYen } from "@/lib/money";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/input";

/** 円入力（全角・カンマ可、整数のみ）。表示はカンマ区切り */
export const YenInput = React.forwardRef<
  HTMLInputElement,
  {
    value: number | null | undefined;
    onChange: (v: number | null) => void;
    id?: string;
    name?: string;
    placeholder?: string;
    className?: string;
    invalid?: boolean;
    disabled?: boolean;
    "aria-label"?: string;
  }
>(function YenInput({ value, onChange, className, invalid, ...rest }, ref) {
  const [text, setText] = React.useState(value === null || value === undefined ? "" : value.toLocaleString("ja-JP"));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setText(value === null || value === undefined ? "" : value.toLocaleString("ja-JP"));
  }, [value, focused]);
  return (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn(inputClass, "num pr-8 text-right text-lg font-semibold sm:text-base", className)}
        aria-invalid={invalid || undefined}
        value={text}
        onFocus={() => {
          setFocused(true);
          setText(value === null || value === undefined ? "" : String(value));
        }}
        onBlur={() => {
          setFocused(false);
          const v = parseYen(text);
          onChange(v);
          setText(v === null ? "" : v.toLocaleString("ja-JP"));
        }}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseYen(e.target.value));
        }}
        {...rest}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted">円</span>
    </div>
  );
});
