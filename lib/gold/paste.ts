/**
 * 相場表の貼り付けテキストから品位ごとの単価（円/g）を読み取る。
 * 買取店サイトの相場表をコピーした文字列を想定（表記ゆれに対応）。
 *   例: "K18 16,500円" / "18金 16500円/g" / "Pt900（プラチナ900）4,800円" / "SV925 120円"
 * 読み取り結果は必ず画面で確認してから保存する（自動で保存はしない）。
 */
import { parseHundredths } from "./calc";

interface GradePattern {
  code: string;
  patterns: RegExp[];
}

// 品位の表記パターン（長いものから順に判定し、K21.6 と K21 等の誤認を防ぐ）
const G = (code: string, ...patterns: string[]): GradePattern => ({
  code,
  patterns: patterns.map((p) => new RegExp(`(?:^|[^0-9A-Za-z.])(?:${p})(?![0-9.])`, "i")),
});

export const GRADE_PATTERNS: GradePattern[] = [
  G("K21.6", "K\\s*21\\.6", "21\\.6\\s*金"),
  G("K24", "K\\s*24", "24\\s*金", "純金", "インゴット"),
  G("K22", "K\\s*22", "22\\s*金"),
  G("K20", "K\\s*20", "20\\s*金"),
  G("K18", "K\\s*18", "18\\s*金"),
  G("K14", "K\\s*14", "14\\s*金"),
  G("K10", "K\\s*10", "10\\s*金"),
  G("K9", "K\\s*9", "9\\s*金"),
  G("Pt1000", "Pt\\s*1000", "プラチナ\\s*1000", "純プラチナ"),
  G("Pt950", "Pt\\s*950", "プラチナ\\s*950"),
  G("Pt900", "Pt\\s*900", "プラチナ\\s*900"),
  G("Pt850", "Pt\\s*850", "プラチナ\\s*850"),
  G("SV1000", "SV\\s*1000", "Silver\\s*1000", "純銀"),
  G("SV925", "SV\\s*925", "Silver\\s*925", "銀\\s*925"),
  G("Pd1000", "Pd\\s*1000", "パラジウム"),
];

function normalize(text: string): string {
  return text
    .replace(/[０-９Ａ-Ｚａ-ｚ．，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[￥¥]/g, "")
    .replace(/ /g, " ");
}

/** 価格らしい数値（1,234 / 1234 / 1,234.5）。重量やパーセントを避けるため 2桁以上 */
const PRICE_RE = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{2,7}(?:\.\d{1,2})?)\s*(?:円|yen)?(?!\s*(?:%|％|g\b|ｇ))/i;

export interface PasteResult {
  prices: Record<string, string>; // grade_code → "16500"
  unmatchedLines: string[];
}

export function parsePastedPrices(text: string): PasteResult {
  const prices: Record<string, string> = {};
  const unmatchedLines: string[] = [];
  const lines = normalize(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 品位名と価格が別の行にある表にも対応するため、次の行も連結して探す
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const window = `${line} ${lines[i + 1] ?? ""}`;
    let matched = false;
    for (const g of GRADE_PATTERNS) {
      if (prices[g.code]) continue;
      const m = g.patterns.map((p) => p.exec(line)).find(Boolean);
      if (!m) continue;
      const after = window.slice((m.index ?? 0) + m[0].length);
      const pm = PRICE_RE.exec(after);
      if (!pm) continue;
      const value = parseHundredths(pm[1]);
      if (value === null) continue;
      prices[g.code] = pm[1].replace(/,/g, "");
      matched = true;
      break; // 1行1品位
    }
    if (!matched && /\d/.test(line) && line.length < 80) unmatchedLines.push(line);
  }
  return { prices, unmatchedLines };
}
