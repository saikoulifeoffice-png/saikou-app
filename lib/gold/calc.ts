/**
 * 貴金属買取の計算（浮動小数点を使わない）
 *
 *   商品別地金金額 = 重量(g) × 参考相場単価(円/g)  … 1円未満を四捨五入
 *   地金総額       = 商品別地金金額の合計
 *   見込み利益     = 地金総額 − お客様への支払額（マイナスもそのまま表示）
 *   利益率         = 見込み利益 ÷ 地金総額 × 100（地金総額0のときは表示しない）
 *
 * 重量・単価は小数2桁まで。内部では 1/100 単位の整数（BigInt）で計算する。
 * DB の app.pm_metal_value と同一仕様（tests/db で一致を検証）。
 */
import { marginBasisPoints } from "@/lib/money";

/** "12.3" → 1230（1/100単位）。全角数字・カンマ可。小数3桁以上・負・0以下は null */
export function parseHundredths(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input)
    .replace(/[０-９．]/g, (c) => (c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
    .replace(/[,，\s円gｇ]/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return v > 0 ? v : null;
}

/** 1/100単位の整数 → 表示用文字列（末尾の0は省略しない: 12.30 → "12.3"） */
export function formatHundredths(v: number | null | undefined, opts: { fixed?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const int = Math.floor(v / 100);
  const frac = v % 100;
  const intStr = int.toLocaleString("ja-JP");
  if (opts.fixed) return `${intStr}.${String(frac).padStart(2, "0")}`;
  if (frac === 0) return intStr;
  return `${intStr}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** 1/100単位の文字列表現（DB送信用 "12.30"） */
export function hundredthsToDecimal(v: number): string {
  return `${Math.floor(v / 100)}.${String(v % 100).padStart(2, "0")}`;
}

/** 商品別地金金額（円）。weight・price は 1/100 単位の整数 */
export function metalValue(weightHundredths: number, priceHundredths: number): number {
  if (!Number.isSafeInteger(weightHundredths) || weightHundredths <= 0) throw new RangeError("重量が不正です");
  if (!Number.isSafeInteger(priceHundredths) || priceHundredths <= 0) throw new RangeError("単価が不正です");
  const prod = BigInt(weightHundredths) * BigInt(priceHundredths); // 1/10000 円
  return Number((prod + 5000n) / 10000n); // 四捨五入（正の値のみ）
}

export interface GoldLine {
  weight: number | null; // 1/100 g
  price: number | null; // 1/100 円/g
}

export interface GoldSummary {
  lineValues: (number | null)[];
  totalMetalValue: number;
  paidAmount: number;
  expectedProfit: number;
  marginBp: number | null;
  complete: boolean; // 全行の重量・単価が入力済み
}

export function summarizeGold(lines: GoldLine[], paidAmount: number | null): GoldSummary {
  const lineValues = lines.map((l) => (l.weight && l.price ? metalValue(l.weight, l.price) : null));
  const totalMetalValue = lineValues.reduce<number>((a, v) => a + (v ?? 0), 0);
  const paid = paidAmount ?? 0;
  const expectedProfit = totalMetalValue - paid;
  return {
    lineValues,
    totalMetalValue,
    paidAmount: paid,
    expectedProfit,
    marginBp: marginBasisPoints(expectedProfit, totalMetalValue),
    complete: lineValues.every((v) => v !== null),
  };
}
