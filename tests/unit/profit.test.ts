import { describe, expect, it } from "vitest";
import { previewSale, summarize } from "@/lib/calc/profit";

describe("summarize", () => {
  it("粗利・純利益・利益率", () => {
    const s = summarize([
      { revenue: 100000, cost: 60000, directExpense: 5000 },
      { revenue: 50000, cost: 20000, directExpense: 2000 },
    ]);
    expect(s.revenue).toBe(150000);
    expect(s.costOfSales).toBe(80000);
    expect(s.grossProfit).toBe(70000);
    expect(s.directExpense).toBe(7000);
    expect(s.netProfit).toBe(63000);
    expect(s.marginBp).toBe(4200);
  });

  it("返品（マイナス行）を相殺する", () => {
    const s = summarize([
      { revenue: 100000, cost: 60000, directExpense: 5000 },
      { revenue: -100000, cost: -60000, directExpense: 1000 },
    ]);
    expect(s.revenue).toBe(0);
    expect(s.netProfit).toBe(-6000);
    expect(s.marginBp).toBeNull();
  });
});

describe("previewSale", () => {
  it("一括金額を原価比で按分し、直接費を売上比で按分", () => {
    const r = previewSale({
      mode: "cost",
      totalRevenue: 100000,
      lines: [{ cost: 30000 }, { cost: 10000 }],
      expenses: [10000, 1001],
    });
    expect(r.lines.map((l) => l.revenue)).toEqual([75000, 25000]);
    expect(r.lines.map((l) => l.directExpense)).toEqual([8251, 2750]);
    expect(r.summary?.netProfit).toBe(100000 - 40000 - 11001);
  });

  it("原価が見えない行がある場合は合計利益を出さない", () => {
    const r = previewSale({ mode: "manual", lines: [{ cost: null, revenue: 5000 }], expenses: [] });
    expect(r.lines[0].profit).toBeNull();
    expect(r.summary).toBeNull();
  });
});
