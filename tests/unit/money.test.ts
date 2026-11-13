import { describe, expect, it } from "vitest";
import {
  allocate,
  costForQuantity,
  formatMargin,
  formatYen,
  inclFromExcl,
  marginBasisPoints,
  parseYen,
  splitIncl,
  taxFromIncl,
} from "@/lib/money";

describe("allocate（最大剰余法）", () => {
  it("合計が必ず一致する", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 3, 3, 1])).toEqual([3, 3, 3, 1]);
    expect(allocate(1000, [333, 333, 334])).toEqual([333, 333, 334]);
  });

  it("剰余が大きい順、同値なら前方優先で配分する", () => {
    // 100 * [1,2,3] / 6 = 16.67, 33.33, 50 → 剰余 4,2,0 → 先頭に+1
    expect(allocate(100, [1, 2, 3])).toEqual([17, 33, 50]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("重みがすべて0なら均等配分", () => {
    expect(allocate(10, [0, 0, 0])).toEqual([4, 3, 3]);
  });

  it("負の金額は絶対値で按分して符号を戻す", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it("0円は全て0", () => {
    expect(allocate(0, [5, 7])).toEqual([0, 0]);
  });

  it("ランダム入力でも合計一致・各要素は理論値±1以内", () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let k = 0; k < 500; k++) {
      const n = 1 + (rnd() % 8);
      const weights = Array.from({ length: n }, () => rnd() % 1_000_000);
      const total = rnd() % 50_000_000;
      const out = allocate(total, weights);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      const sum = weights.reduce((a, b) => a + b, 0) || n;
      out.forEach((v, i) => {
        const ideal = (total * (sum === n && weights.every((w) => w === 0) ? 1 : weights[i])) / sum;
        expect(Math.abs(v - ideal)).toBeLessThan(1);
      });
    }
  });

  it("巨大な金額でも精度を失わない", () => {
    const out = allocate(999_999_999_999, [999_999_999, 1]);
    expect(out[0] + out[1]).toBe(999_999_999_999);
  });

  it("不正な入力を拒否する", () => {
    expect(() => allocate(100, [])).toThrow();
    expect(() => allocate(100, [-1, 2])).toThrow();
    expect(() => allocate(1.5, [1])).toThrow();
  });
});

describe("消費税", () => {
  it("税込から税額を算出（切り捨て）", () => {
    expect(taxFromIncl(11000, "standard_10")).toBe(1000);
    expect(taxFromIncl(10800, "reduced_8")).toBe(800);
    expect(taxFromIncl(1000, "standard_10")).toBe(90); // 90.9 → 90
    expect(taxFromIncl(1000, "standard_10", "round")).toBe(91);
    expect(taxFromIncl(1000, "standard_10", "ceil")).toBe(91);
    expect(taxFromIncl(1000, "exempt")).toBe(0);
    expect(taxFromIncl(1000, "non_taxable")).toBe(0);
    expect(taxFromIncl(1000, "tax_free_export")).toBe(0);
  });

  it("マイナス金額（返品）は符号を保つ", () => {
    expect(taxFromIncl(-1000, "standard_10")).toBe(-90);
  });

  it("税込 = 税抜 + 税額", () => {
    for (const v of [0, 1, 99, 1000, 123456789]) {
      const s = splitIncl(v, "standard_10");
      expect(s.excl + s.tax).toBe(s.incl);
    }
    expect(inclFromExcl(10000, "standard_10")).toEqual({ incl: 11000, excl: 10000, tax: 1000 });
  });
});

describe("costForQuantity", () => {
  it("最後の1点で残原価をすべて充当する", () => {
    const total = 1000;
    const c1 = costForQuantity(total, 3, 1); // 333
    const c2 = costForQuantity(total - c1, 2, 1); // 333
    const c3 = costForQuantity(total - c1 - c2, 1, 1); // 334
    expect([c1, c2, c3]).toEqual([333, 333, 334]);
    expect(c1 + c2 + c3).toBe(total);
  });
});

describe("利益率・表示", () => {
  it("ベーシスポイントで計算", () => {
    expect(marginBasisPoints(25, 100)).toBe(2500);
    expect(marginBasisPoints(1, 3)).toBe(3333);
    expect(marginBasisPoints(2, 3)).toBe(6667);
    expect(marginBasisPoints(-1, 3)).toBe(-3333);
    expect(marginBasisPoints(10, 0)).toBeNull();
  });
  it("表示", () => {
    expect(formatMargin(3333)).toBe("33.3%");
    expect(formatMargin(-3335)).toBe("-33.4%");
    expect(formatMargin(null)).toBe("—");
    expect(formatYen(1234567)).toBe("1,234,567円");
    expect(formatYen(-500)).toBe("-500円");
  });
});

describe("parseYen", () => {
  it("全角・カンマ・円記号を許容", () => {
    expect(parseYen("１２，３４５円")).toBe(12345);
    expect(parseYen("¥1,000")).toBe(1000);
    expect(parseYen("-300")).toBe(-300);
    expect(parseYen("12.5")).toBeNull();
    expect(parseYen("abc")).toBeNull();
    expect(parseYen("")).toBeNull();
  });
});
