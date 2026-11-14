import { describe, expect, it } from "vitest";
import { parsePastedPrices } from "@/lib/gold/paste";

describe("相場表の貼り付け読み取り", () => {
  it("一般的な表記を読み取る", () => {
    const r = parsePastedPrices(`本日の買取相場 2026年11月14日 10:00更新
K24 21,500円
K22 19,700円
K18 16,500円/g
K14 12,500円
K10 8,900円
Pt1000 5,200円
Pt900 4,800.5円
SV925 120円`);
    expect(r.prices).toEqual({
      K24: "21500", K22: "19700", K18: "16500", K14: "12500", K10: "8900", Pt1000: "5200", Pt900: "4800.5", SV925: "120",
    });
  });

  it("全角・漢字表記・別の行の価格・円記号", () => {
    const r = parsePastedPrices(`18金（Ｋ１８）
￥１６，５００
プラチナ900\t4,800円
純金 インゴット 21500円
K21.6 20,000円`);
    expect(r.prices.K18).toBe("16500");
    expect(r.prices.Pt900).toBe("4800");
    expect(r.prices.K24).toBe("21500");
    expect(r.prices["K21.6"]).toBe("20000");
    expect(r.prices.K21).toBeUndefined();
  });

  it("日付・重量・パーセントを価格と誤認しない", () => {
    const r = parsePastedPrices(`K18 前日比 +1.2% 16,400円
K24 10g あたり 215,000円`);
    expect(r.prices.K18).toBe("16400");
    expect(r.prices.K24).toBe("215000"); // 1g単価でない表記は画面で利用者が確認・修正する
  });

  it("読み取れない行を返す", () => {
    const r = parsePastedPrices("お問い合わせ 0120-000-000\nK18 16,500円");
    expect(r.prices.K18).toBe("16500");
    expect(r.unmatchedLines).toContain("お問い合わせ 0120-000-000");
  });
});
