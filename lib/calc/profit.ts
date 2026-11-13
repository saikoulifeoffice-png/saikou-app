/**
 * 利益計算（純関数）
 *
 * 定義（docs/phase1-design.md §3.2）:
 *   総売上         = Σ 売上（返品はマイナス）
 *   売上原価       = Σ 販売済み商品の原価スナップショット（未販売在庫は含まない）
 *   粗利益         = 総売上 − 売上原価
 *   商品利益       = 売上 − 買取原価 − 販売直接費（明細単位）
 *   管理上の純利益 = 粗利益 − 販売直接費 − 配賦した一般経費
 *   利益率         = 管理上の純利益 ÷ 総売上
 * 税基準（税込/税抜）は呼び出し側で1つに固定して渡すこと（混在禁止）。
 */
import { allocate, marginBasisPoints, sumYen } from "@/lib/money";

export interface ProfitLine {
  revenue: number;
  cost: number;
  directExpense: number;
}

export interface ProfitSummary {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  directExpense: number;
  generalExpense: number;
  netProfit: number;
  marginBp: number | null;
}

export function lineProfit(line: ProfitLine): number {
  return line.revenue - line.cost - line.directExpense;
}

export function summarize(lines: readonly ProfitLine[], generalExpense = 0): ProfitSummary {
  const revenue = sumYen(lines.map((l) => l.revenue));
  const costOfSales = sumYen(lines.map((l) => l.cost));
  const directExpense = sumYen(lines.map((l) => l.directExpense));
  const grossProfit = revenue - costOfSales;
  const netProfit = grossProfit - directExpense - generalExpense;
  return {
    revenue,
    costOfSales,
    grossProfit,
    directExpense,
    generalExpense,
    netProfit,
    marginBp: marginBasisPoints(netProfit, revenue),
  };
}

export interface SalePreviewInput {
  lines: { cost: number | null; revenue?: number | null }[];
  mode: "manual" | "cost";
  totalRevenue?: number | null;
  expenses: number[];
}

export interface SalePreviewLine {
  revenue: number;
  directExpense: number;
  cost: number | null;
  profit: number | null;
}

/**
 * 販売登録画面のプレビュー計算（サーバーの register_sale と同じ按分規則）
 * - mode=cost: 一括金額を原価比で按分
 * - 販売直接費: 売上比で按分（売上合計0なら原価比→均等）
 * 原価が見えない（他人の商品）行は利益を null とする。
 */
export function previewSale(input: SalePreviewInput): { lines: SalePreviewLine[]; summary: ProfitSummary | null } {
  const n = input.lines.length;
  if (n === 0) return { lines: [], summary: null };
  const costs = input.lines.map((l) => l.cost ?? 0);
  const revenues =
    input.mode === "cost"
      ? allocate(input.totalRevenue ?? 0, costs)
      : input.lines.map((l) => l.revenue ?? 0);
  const revTotal = sumYen(revenues);
  const expenseTotal = sumYen(input.expenses);
  const expenseAlloc = allocate(expenseTotal, revTotal > 0 ? revenues : costs);
  const lines = input.lines.map((l, i) => ({
    revenue: revenues[i],
    directExpense: expenseAlloc[i],
    cost: l.cost,
    profit: l.cost === null ? null : revenues[i] - l.cost - expenseAlloc[i],
  }));
  const allVisible = input.lines.every((l) => l.cost !== null);
  return {
    lines,
    summary: allVisible
      ? summarize(lines.map((l) => ({ revenue: l.revenue, cost: l.cost ?? 0, directExpense: l.directExpense })))
      : null,
  };
}
