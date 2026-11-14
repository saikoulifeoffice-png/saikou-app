/**
 * 金額計算ユーティリティ（円・整数のみ）
 *
 * - 金額はすべて整数の円で扱い、浮動小数点演算を使わない（内部計算は BigInt）
 * - DB 側（supabase/migrations の app.allocate / app.tax_from_incl 等）と同一仕様。
 *   tests/db で両者の一致を検証している。
 */

export type TaxCategory = "standard_10" | "reduced_8" | "exempt" | "non_taxable" | "tax_free_export";
export type RoundingMode = "floor" | "round" | "ceil";

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  standard_10: "課税10%",
  reduced_8: "軽減8%",
  exempt: "非課税",
  non_taxable: "不課税",
  tax_free_export: "免税（輸出等）",
};

/** 安全に扱える最大金額（1兆円）。これを超える入力は拒否する */
export const MAX_YEN = 1_000_000_000_000;

export function isYen(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_YEN;
}

export function assertYen(value: unknown, label = "金額"): asserts value is number {
  if (!isYen(value)) {
    throw new RangeError(`${label}は${MAX_YEN.toLocaleString("ja-JP")}円以下の整数で指定してください`);
  }
}

export function taxRate(category: TaxCategory): number {
  switch (category) {
    case "standard_10":
      return 10;
    case "reduced_8":
      return 8;
    default:
      return 0;
  }
}

/** 非負整数の除算（端数処理指定）。round は 0.5 切り上げ */
function divRound(num: bigint, den: bigint, mode: RoundingMode): bigint {
  if (num < 0n || den <= 0n) throw new RangeError("divRound は非負の分子・正の分母のみ対応");
  switch (mode) {
    case "floor":
      return num / den;
    case "ceil":
      return (num + den - 1n) / den;
    case "round":
      return (num * 2n + den) / (den * 2n);
  }
}

/** 税込金額に含まれる消費税額（符号は元の金額に従う） */
export function taxFromIncl(incl: number, category: TaxCategory, mode: RoundingMode = "floor"): number {
  assertYen(incl);
  const r = taxRate(category);
  if (r === 0 || incl === 0) return 0;
  const sign = incl < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(incl));
  return Number(sign * divRound(abs * BigInt(r), BigInt(100 + r), mode));
}

export interface TaxSplit {
  incl: number;
  excl: number;
  tax: number;
}

export function splitIncl(incl: number, category: TaxCategory, mode: RoundingMode = "floor"): TaxSplit {
  const tax = taxFromIncl(incl, category, mode);
  return { incl, excl: incl - tax, tax };
}

/** 税抜金額から税込金額を算出 */
export function inclFromExcl(excl: number, category: TaxCategory, mode: RoundingMode = "floor"): TaxSplit {
  assertYen(excl);
  const r = taxRate(category);
  const sign = excl < 0 ? -1n : 1n;
  const tax = r === 0 ? 0 : Number(sign * divRound(BigInt(Math.abs(excl)) * BigInt(r), 100n, mode));
  return { incl: excl + tax, excl, tax };
}

/**
 * 最大剰余法による按分。
 * - 戻り値の合計は必ず total と一致する
 * - 剰余が同じ場合は配列の前方を優先（決定的）
 * - 重みがすべて 0 の場合は均等配分
 * - total が負の場合は絶対値で按分して符号を戻す
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertYen(total, "按分元金額");
  if (weights.length === 0) throw new RangeError("按分対象がありません");
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new RangeError("按分の重みは0以上の整数である必要があります");
  }
  const sign = total < 0 ? -1 : 1;
  const t = BigInt(Math.abs(total));
  let ws = weights.map((w) => BigInt(w));
  let sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    ws = ws.map(() => 1n);
    sum = BigInt(ws.length);
  }
  const base = ws.map((w) => (t * w) / sum);
  const rem = ws.map((w) => (t * w) % sum);
  let leftover = t - base.reduce((a, b) => a + b, 0n);
  const order = rem
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of order) {
    if (leftover <= 0n) break;
    base[i] += 1n;
    leftover -= 1n;
  }
  return base.map((b) => sign * Number(b));
}

/** 在庫から一部数量を出す際の原価（最後の1点で残原価をすべて充当し端数を残さない） */
export function costForQuantity(remainingCost: number, remainingQty: number, qty: number): number {
  assertYen(remainingCost);
  if (!Number.isSafeInteger(remainingQty) || remainingQty <= 0) throw new RangeError("残数量が不正です");
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new RangeError("数量が不正です");
  if (qty >= remainingQty) return remainingCost;
  const sign = remainingCost < 0 ? -1n : 1n;
  return Number(sign * ((BigInt(Math.abs(remainingCost)) * BigInt(qty)) / BigInt(remainingQty)));
}

export function sumYen(values: readonly number[]): number {
  let s = 0n;
  for (const v of values) {
    assertYen(v);
    s += BigInt(v);
  }
  const n = Number(s);
  assertYen(n, "合計");
  return n;
}

/**
 * 利益率を「ベーシスポイント（0.01%単位）」の整数で返す。
 * 売上が0の場合は null（表示は「—」）。四捨五入（0から遠い方へ）。
 */
export function marginBasisPoints(profit: number, revenue: number): number | null {
  assertYen(profit);
  assertYen(revenue);
  if (revenue === 0) return null;
  const p = BigInt(profit) * 10000n;
  const r = BigInt(revenue);
  const neg = p < 0n !== r < 0n;
  const ap = p < 0n ? -p : p;
  const ar = r < 0n ? -r : r;
  const q = (ap * 2n + ar) / (ar * 2n);
  return Number(neg ? -q : q);
}

export function formatMargin(bp: number | null): string {
  if (bp === null) return "—";
  const sign = bp < 0 ? "-" : "";
  const abs = Math.abs(bp);
  // 0.1%単位で表示（bp を 10 で四捨五入）
  const tenths = Math.floor((abs + 5) / 10);
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

const yenFormatter = new Intl.NumberFormat("ja-JP");

export function formatYen(value: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (value === null || value === undefined) return "—";
  const s = yenFormatter.format(value);
  return `${opts.sign && value > 0 ? "+" : ""}${s}円`;
}

/** 入力文字列（全角数字・カンマ・円記号を許容）を整数円に変換。不正なら null */
export function parseYen(input: string): number | null {
  const normalized = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，,、\s円¥￥]/g, "")
    .replace(/[－−ー]/g, "-");
  if (!/^-?\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  return isYen(n) ? n : null;
}
