// グレード判定の基準表と判定ロジック
// 数値は「大きい側の割合（%）の上限」。例: 55 は 55/45 以内。
// ※各社の公式ページはこの開発環境から直接確認できなかったため、
//   複数の解説サイトで一致していた値を使っています（README参照）。

export const PSA = {
  name: 'PSA',
  front: [
    [10, 55], // 2025年に 60/40 → 55/45 へ厳格化
    [9, 60],
    [8, 65],
    [7, 70],
    [6, 80],
    [5, 85],
    [4, 85],
    [3, 90],
    [2, 90],
  ],
  back: [
    [10, 75],
    [9, 90],
    [8, 90],
    [7, 90],
    [6, 90],
    [5, 90],
    [4, 90],
    [3, 90],
    [2, 90],
  ],
  labels: {
    10: 'GEM MINT 10',
    9: 'MINT 9',
    8: 'NM-MT 8',
    7: 'NM 7',
    6: 'EX-MT 6',
    5: 'EX 5',
    4: 'VG-EX 4',
    3: 'VG 3',
    2: 'GOOD 2',
    1: 'PR 1',
  },
};

/**
 * センタリングだけで見たPSAの上限グレードを返す
 * @param {number} worstPct 左右・上下のうち「大きい側」の割合の最大値（50〜100）
 * @param {'front'|'back'} face 表面 or 裏面
 * @param {number} uncertainty 測定誤差（%）。境界付近かどうかの判定に使う
 */
export function psaGrade(worstPct, face, uncertainty = 0) {
  const table = face === 'back' ? PSA.back : PSA.front;
  let grade = 1;
  let limit = null;
  for (const [g, lim] of table) {
    if (worstPct <= lim) {
      grade = g;
      limit = lim;
      break;
    }
  }
  // ひとつ上のグレードの基準（あれば）
  const better = table.filter(([g, lim]) => g > grade && lim < (limit ?? 101));
  const next = better.length ? better[better.length - 1] : null;

  // 境界付近：誤差の範囲内に基準線がある
  let borderline = false;
  if (limit !== null && limit - worstPct <= uncertainty) borderline = true;
  if (next && worstPct - next[1] <= uncertainty) borderline = true;

  return {
    grade,
    label: PSA.labels[grade],
    limit,
    nextGrade: next ? next[0] : null,
    nextLimit: next ? next[1] : null,
    borderline,
  };
}
