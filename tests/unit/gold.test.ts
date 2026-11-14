import { describe, expect, it } from "vitest";
import { formatHundredths, hundredthsToDecimal, metalValue, parseHundredths, summarizeGold } from "@/lib/gold/calc";
import { formatMargin } from "@/lib/money";

describe("重量・単価の入力", () => {
  it("小数2桁まで・全角・カンマ・単位を許容", () => {
    expect(parseHundredths("12.3")).toBe(1230);
    expect(parseHundredths("１２．３４")).toBe(1234);
    expect(parseHundredths("21,500円")).toBe(2150000);
    expect(parseHundredths("5g")).toBe(500);
    expect(parseHundredths("0.01")).toBe(1);
  });
  it("不正値は null", () => {
    for (const v of ["", "0", "-1", "1.234", "abc", "1..2"]) expect(parseHundredths(v)).toBeNull();
  });
  it("表示", () => {
    expect(formatHundredths(1230)).toBe("12.3");
    expect(formatHundredths(1234)).toBe("12.34");
    expect(formatHundredths(2150000)).toBe("21,500");
    expect(formatHundredths(1230, { fixed: true })).toBe("12.30");
    expect(hundredthsToDecimal(1205)).toBe("12.05");
  });
});

describe("地金金額", () => {
  it("重量 × 単価を1円単位に四捨五入", () => {
    expect(metalValue(1000, 2150000)).toBe(215000); // 10g × 21,500円
    expect(metalValue(333, 1650000)).toBe(54945); // 3.33g × 16,500 = 54,945
    expect(metalValue(1, 1)).toBe(0); // 0.01 × 0.01 = 0.0001 → 0
    expect(metalValue(50, 101)).toBe(1); // 0.5 × 1.01 = 0.505 → 1（四捨五入）
    expect(metalValue(50, 99)).toBe(0); // 0.495 → 0
    expect(metalValue(1234, 1234567)).toBe(152346); // 12.34 × 12345.67 = 152345.5678 → 152346
  });
  it("大きな値でも誤差なし", () => {
    expect(metalValue(99999999, 999999999)).toBe(Number((99999999n * 999999999n + 5000n) / 10000n));
  });
});

describe("集計", () => {
  it("地金総額・見込み利益・利益率", () => {
    const s = summarizeGold([{ weight: 1000, price: 2150000 }, { weight: 520, price: 1650000 }], 250000);
    expect(s.lineValues).toEqual([215000, 85800]);
    expect(s.totalMetalValue).toBe(300800);
    expect(s.expectedProfit).toBe(50800);
    expect(formatMargin(s.marginBp)).toBe("16.9%");
  });
  it("マイナスの利益もそのまま", () => {
    const s = summarizeGold([{ weight: 100, price: 1000000 }], 12000);
    expect(s.totalMetalValue).toBe(10000);
    expect(s.expectedProfit).toBe(-2000);
    expect(formatMargin(s.marginBp)).toBe("-20.0%");
  });
  it("未入力行があっても計算でき、利益率は地金総額0なら表示しない", () => {
    const s = summarizeGold([{ weight: null, price: 1000 }], 0);
    expect(s.complete).toBe(false);
    expect(s.marginBp).toBeNull();
  });
});
