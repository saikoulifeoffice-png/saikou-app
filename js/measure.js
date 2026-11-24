// センタリング測定の画像処理
// 流れ：
//   1. カード外形（四角形）を検出
//   2. 透視変換で 63×88mm の比率に補正（1mm = 25px → 1575×2200px）
//   3. 補正後の画像で外枠を走査線で測り直し、角の位置を精密化して再補正
//   4. 各辺 41 本の走査線で「外枠 → 内枠」の幅をサブピクセル精度で測定
//   5. 外れ値を除いて中央値を取り、ばらつき（誤差）も計算

export const CARD_W_MM = 63;
export const CARD_H_MM = 88;
export const PX_PER_MM = 25;
export const CARD_W = CARD_W_MM * PX_PER_MM; // 1575
export const CARD_H = CARD_H_MM * PX_PER_MM; // 2200
export const MARGIN = 64; // 補正画像でカードの外側に残す余白(px)
export const OUT_W = CARD_W + MARGIN * 2;
export const OUT_H = CARD_H + MARGIN * 2;

const SCAN_LINES = 41; // 1辺あたりの走査線の本数
const SCAN_FROM = 0.15; // 角の丸みを避けるため、辺の15%〜85%だけ使う
const SCAN_TO = 0.85;
const SYSTEMATIC_ERR = 0.2; // 合成画像テストでの最大誤差(約0.18%)をもとにした下限 (%)

/* ------------------------------------------------------------------ */
/* 小さな数学ヘルパー                                                   */
/* ------------------------------------------------------------------ */

function median(arr) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 外れ値を除く：中央値からの距離が 3σ（MADから推定）を超えるものを外す */
export function robustStats(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 3) {
    return { median: median(v), sigma: Infinity, inliers: v, inlierMask: values.map(() => false), n: v.length };
  }
  const m = median(v);
  const mad = median(v.map((x) => Math.abs(x - m)));
  const sigma = Math.max(1.4826 * mad, 0.25);
  const tol = Math.max(3 * sigma, 1.5);
  const inlierMask = values.map((x) => Number.isFinite(x) && Math.abs(x - m) <= tol);
  const inliers = values.filter((_, i) => inlierMask[i]);
  const m2 = median(inliers);
  // 外れ値を除いた後の標準偏差
  const mean = inliers.reduce((a, b) => a + b, 0) / inliers.length;
  const sd = Math.sqrt(inliers.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, inliers.length - 1));
  return { median: m2, sigma: Math.max(sd, 0.1), inliers, inlierMask, n: inliers.length };
}

/** 放物線補間で、ピーク位置を小数点以下（サブピクセル）まで求める */
function parabolicPeak(g, i) {
  if (i <= 0 || i >= g.length - 1) return i;
  const a = g[i - 1], b = g[i], c = g[i + 1];
  const den = a - 2 * b + c;
  if (den === 0) return i;
  const d = (0.5 * (a - c)) / den;
  return i + Math.max(-0.5, Math.min(0.5, d));
}

/** 直線 x = a*y + b（または y = a*x + b）をロバストに当てはめる */
function fitLineRobust(ts, vs) {
  const pts = ts.map((t, i) => [t, vs[i]]).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 5) return null;
  let use = pts;
  let a = 0, b = 0;
  for (let iter = 0; iter < 3; iter++) {
    const n = use.length;
    const mt = use.reduce((s, p) => s + p[0], 0) / n;
    const mv = use.reduce((s, p) => s + p[1], 0) / n;
    let sxx = 0, sxy = 0;
    for (const [t, v] of use) {
      sxx += (t - mt) ** 2;
      sxy += (t - mt) * (v - mv);
    }
    a = sxx ? sxy / sxx : 0;
    b = mv - a * mt;
    const res = pts.map(([t, v]) => Math.abs(v - (a * t + b)));
    const tol = Math.max(1.5, 3 * 1.4826 * median(res));
    const next = pts.filter((_, i) => res[i] <= tol);
    if (next.length < 5) break;
    use = next;
  }
  return { a, b };
}

/* ------------------------------------------------------------------ */
/* 1. カード外形の検出                                                  */
/* ------------------------------------------------------------------ */

/** 4点を 左上・右上・右下・左下 の順に並べる */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort(
    (p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx)
  );
  // atan2 の順（-π〜π）は 左上→右上→右下→左下 に近い並びになる。左上(x+yが最小)を先頭に回す
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    if (p.x + p.y < best) {
      best = p.x + p.y;
      start = i;
    }
  });
  const ordered = [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]);
  // カードは縦長なので、横長に見えたら1つずらす
  const top = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
  const side = Math.hypot(ordered[3].x - ordered[0].x, ordered[3].y - ordered[0].y);
  if (top > side * 1.05) return [ordered[3], ordered[0], ordered[1], ordered[2]];
  return ordered;
}

/** 90度単位でカードの向きを回す（ユーザーが「回転」を押したとき用） */
export function rotateCorners(corners, k = 1) {
  const n = ((k % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => corners[(i + n) % 4]);
}

function quadFromMat(approx, scale) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    pts.push({ x: approx.data32S[i * 2] / scale, y: approx.data32S[i * 2 + 1] / scale });
  }
  return pts;
}

function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], r = q[(i + 1) % 4];
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
}

function quadAspect(q) {
  const o = orderCorners(q);
  const w = (Math.hypot(o[1].x - o[0].x, o[1].y - o[0].y) + Math.hypot(o[2].x - o[3].x, o[2].y - o[3].y)) / 2;
  const h = (Math.hypot(o[3].x - o[0].x, o[3].y - o[0].y) + Math.hypot(o[2].x - o[1].x, o[2].y - o[1].y)) / 2;
  return h / w;
}

function rotatedRectPoints(rect, scale) {
  const { center, size, angle } = rect;
  const r = (angle * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const hw = size.width / 2, hh = size.height / 2;
  return [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ].map(([x, y]) => ({ x: (center.x + x * c - y * s) / scale, y: (center.y + x * s + y * c) / scale }));
}

/**
 * 画像からカードの四隅を探す。見つからなければ null。
 * 縮小画像（長辺1000px）で探して、元の解像度の座標で返す。
 */
export function detectCard(cv, src) {
  const scale = Math.min(1, 1000 / Math.max(src.cols, src.rows));
  const small = new cv.Mat();
  cv.resize(src, small, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
  const gray = new cv.Mat();
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  const imgArea = small.cols * small.rows;

  const candidates = [];
  const binaries = [];

  // 方法A：輪郭（エッジ）検出
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 30, 90);
  const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k);
  binaries.push(edges);

  // 方法B：明るさで2値化（暗い背景の上の明るいカード / その逆）
  const otsu = new cv.Mat();
  cv.threshold(gray, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.morphologyEx(otsu, otsu, cv.MORPH_CLOSE, k);
  binaries.push(otsu);
  const otsuInv = new cv.Mat();
  cv.bitwise_not(otsu, otsuInv);
  binaries.push(otsuInv);

  for (const bin of binaries) {
    const contours = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < imgArea * 0.08 || area > imgArea * 0.985) {
        c.delete();
        continue;
      }
      const hull = new cv.Mat();
      cv.convexHull(c, hull);
      const peri = cv.arcLength(hull, true);
      let quad = null;
      let exact = false;
      for (const eps of [0.01, 0.02, 0.03, 0.05]) {
        const approx = new cv.Mat();
        cv.approxPolyDP(hull, approx, eps * peri, true);
        if (approx.rows === 4) {
          quad = quadFromMat(approx, scale);
          exact = true;
          approx.delete();
          break;
        }
        approx.delete();
      }
      if (!quad) quad = rotatedRectPoints(cv.minAreaRect(hull), scale);
      const aspect = quadAspect(quad);
      if (aspect > 1.1 && aspect < 1.8) {
        const fit = 1 - Math.min(1, Math.abs(aspect - CARD_H / CARD_W) / 0.4);
        const fill = cv.contourArea(c) / (quadArea(quad) * scale * scale);
        candidates.push({ quad, score: area * (0.5 + 0.5 * fit) * (exact ? 1 : 0.8) * Math.min(1, fill + 0.1) });
      }
      hull.delete();
      c.delete();
    }
    contours.delete();
    hier.delete();
  }

  [small, gray, edges, otsu, otsuInv, k].forEach((m) => m.delete());
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return orderCorners(candidates[0].quad);
}

/* ------------------------------------------------------------------ */
/* 2. 透視変換                                                          */
/* ------------------------------------------------------------------ */

const DST_CORNERS = [
  { x: MARGIN, y: MARGIN },
  { x: MARGIN + CARD_W, y: MARGIN },
  { x: MARGIN + CARD_W, y: MARGIN + CARD_H },
  { x: MARGIN, y: MARGIN + CARD_H },
];

function toMat(cv, pts) {
  return cv.matFromArray(4, 1, cv.CV_32FC2, pts.flatMap((p) => [p.x, p.y]));
}

/** 四隅 → 補正画像（RGBA）と、変換行列 */
export function warpCard(cv, src, corners) {
  const s = toMat(cv, corners);
  const d = toMat(cv, DST_CORNERS);
  const M = cv.getPerspectiveTransform(s, d);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, M, new cv.Size(OUT_W, OUT_H), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
  const Minv = M.inv(cv.DECOMP_LU);
  const inv = Array.from(Minv.data64F);
  [s, d, M, Minv].forEach((m) => m.delete());
  return { warped: out, inv };
}

function applyH(h, p) {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/* ------------------------------------------------------------------ */
/* 3–4. 走査線による境界測定                                            */
/* ------------------------------------------------------------------ */

/**
 * 補正画像の端から内側へ向かう1本の走査線の色（RGB）を取り出す。
 * 走査線と直角方向に ±band px を平均してノイズを減らす。
 */
function sampleProfile(data, W, H, side, pos, len, band = 2) {
  const out = new Float32Array(len * 3);
  const p = Math.round(pos);
  for (let t = 0; t < len; t++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = -band; k <= band; k++) {
      let x, y;
      if (side === 'left') { x = t; y = p + k; }
      else if (side === 'right') { x = W - 1 - t; y = p + k; }
      else if (side === 'top') { x = p + k; y = t; }
      else { x = p + k; y = H - 1 - t; }
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    out[t * 3] = r / n; out[t * 3 + 1] = g / n; out[t * 3 + 2] = b / n;
  }
  // [1,2,1] で軽く平滑化
  const sm = new Float32Array(out.length);
  for (let t = 0; t < len; t++) {
    for (let c = 0; c < 3; c++) {
      const a = out[Math.max(0, t - 1) * 3 + c];
      const m = out[t * 3 + c];
      const z = out[Math.min(len - 1, t + 1) * 3 + c];
      sm[t * 3 + c] = (a + 2 * m + z) / 4;
    }
  }
  return sm;
}

/** 色の変化量（各点での RGB の差の合計） */
function gradient(prof, len) {
  const g = new Float32Array(len);
  for (let t = 1; t < len - 1; t++) {
    let s = 0;
    for (let c = 0; c < 3; c++) s += Math.abs(prof[(t + 1) * 3 + c] - prof[(t - 1) * 3 + c]);
    g[t] = s / 2;
  }
  return g;
}

/** 外枠（背景→カード）の位置。外側から見て最初の大きな変化を探す */
function findOuter(g, from, to) {
  let gmax = 0;
  for (let t = from; t < to; t++) gmax = Math.max(gmax, g[t]);
  if (gmax < 12) return NaN;
  const thr = gmax * 0.4;
  let t = from;
  while (t < to && g[t] < thr) t++;
  while (t + 1 < to && g[t + 1] >= g[t]) t++; // 山の頂上まで登る
  return parabolicPeak(g, t);
}

/** 内枠（ボーダー色 → 絵柄側）の位置 */
function findInner(prof, g, tOuter, maxLen, len) {
  const s0 = Math.ceil(tOuter) + 5;
  const refEnd = s0 + 8;
  if (refEnd + 3 >= len) return NaN;
  // ボーダーの色（外枠のすぐ内側の中央値）
  const ref = [0, 1, 2].map((c) => {
    const v = [];
    for (let t = s0; t < refEnd; t++) v.push(prof[t * 3 + c]);
    return median(v);
  });
  const end = Math.min(len - 1, Math.floor(tOuter + maxLen));
  const d = new Float32Array(len);
  let dmax = 0;
  for (let t = refEnd; t < end; t++) {
    let s = 0;
    for (let c = 0; c < 3; c++) s += (prof[t * 3 + c] - ref[c]) ** 2;
    d[t] = Math.sqrt(s);
    dmax = Math.max(dmax, d[t]);
  }
  if (dmax < 18) return NaN;
  const T = Math.min(60, Math.max(18, dmax * 0.35));
  let x0 = -1;
  for (let t = refEnd; t < end - 2; t++) {
    if (d[t] > T && d[t + 1] > T && d[t + 2] > T) { x0 = t; break; }
  }
  if (x0 < 0) return NaN;
  // 変化の始まり付近で、色の変化量が最大になる位置をサブピクセルで求める
  let best = x0, bv = -1;
  for (let t = Math.max(refEnd, x0 - 6); t <= Math.min(end - 1, x0 + 3); t++) {
    if (g[t] > bv) { bv = g[t]; best = t; }
  }
  return parabolicPeak(g, best);
}

/** 1辺ぶんの測定 */
function measureSide(data, W, H, side, opts = {}) {
  const horizontal = side === 'left' || side === 'right'; // 走査線が横向き
  const cardLen = horizontal ? CARD_H : CARD_W; // 走査線を並べる方向の長さ
  const across = horizontal ? CARD_W : CARD_H;
  const from = opts.from ?? SCAN_FROM;
  const to = opts.to ?? SCAN_TO;
  const n = opts.lines ?? SCAN_LINES;
  const len = Math.floor(MARGIN + across * 0.22);
  const maxBorder = across * 0.16; // 内枠を探す最大距離
  const imgLen = horizontal ? W : H;

  const lines = [];
  for (let i = 0; i < n; i++) {
    const pos = MARGIN + cardLen * (from + ((to - from) * i) / (n - 1));
    const prof = sampleProfile(data, W, H, side, pos, len);
    const g = gradient(prof, len);
    const outer = findOuter(g, Math.max(2, MARGIN - 48), MARGIN + 30);
    const inner = opts.outerOnly || !Number.isFinite(outer) ? NaN : findInner(prof, g, outer, maxBorder, len);
    lines.push({ pos, outer, inner, width: inner - outer });
  }
  // t（端からの距離）→ 画像座標へ
  const toImg = (t) => (side === 'left' || side === 'top' ? t : imgLen - 1 - t);
  return { side, lines, toImg };
}

/** 補正画像の外枠の4本の直線を測り、そこから正確な四隅を求める */
function refineCorners(warped) {
  const { data, cols: W, rows: H } = warped;
  const fits = {};
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const r = measureSide(data, W, H, side, { from: 0.1, to: 0.9, lines: 31, outerOnly: true });
    const ts = r.lines.map((l) => l.pos);
    const vs = r.lines.map((l) => r.toImg(l.outer));
    fits[side] = fitLineRobust(ts, vs);
    if (!fits[side]) return null;
  }
  // 左右は x = a*y + b、上下は y = a*x + b
  const cross = (v, h) => {
    // x = av*y + bv,  y = ah*x + bh
    const y = (fits[h].a * fits[v].b + fits[h].b) / (1 - fits[h].a * fits[v].a);
    const x = fits[v].a * y + fits[v].b;
    return { x, y };
  };
  return [cross('left', 'top'), cross('right', 'top'), cross('right', 'bottom'), cross('left', 'bottom')];
}

/* ------------------------------------------------------------------ */
/* 全体の処理                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param cv OpenCV
 * @param src 元画像（cv.Mat RGBA）
 * @param corners 四隅（省略時は自動検出）
 * @returns 測定結果。warped（cv.Mat）は呼び出し側で delete すること
 */
export function analyze(cv, src, corners = null) {
  let autoDetected = true;
  if (!corners) {
    corners = detectCard(cv, src);
    if (!corners) {
      // 見つからない＝カードだけが写った画像（スキャナーで切り抜き済み等）とみなす
      autoDetected = false;
      corners = [
        { x: 0, y: 0 }, { x: src.cols - 1, y: 0 },
        { x: src.cols - 1, y: src.rows - 1 }, { x: 0, y: src.rows - 1 },
      ];
    }
  }

  // 1回目の補正 → 外枠を測り直して四隅を精密化 → 2回目の補正
  let { warped, inv } = warpCard(cv, src, corners);
  const refined = refineCorners(warped);
  if (refined) {
    const srcCorners = refined.map((p) => applyH(inv, p));
    // 精密化で大きく動きすぎた場合（誤検出）は採用しない
    const moved = Math.max(...refined.map((p, i) => Math.hypot(p.x - DST_CORNERS[i].x, p.y - DST_CORNERS[i].y)));
    if (moved < MARGIN * 0.9) {
      warped.delete();
      corners = srcCorners;
      ({ warped, inv } = warpCard(cv, src, corners));
    }
  }

  const result = measureWarped(warped);
  return { ...result, warped, corners, autoDetected };
}

/** 補正済み画像から4辺のボーダー幅を測る */
export function measureWarped(warped) {
  const { data, cols: W, rows: H } = warped;
  const sides = {};
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const r = measureSide(data, W, H, side);
    const widths = r.lines.map((l) => l.width);
    const st = robustStats(widths);
    const outerSt = robustStats(r.lines.map((l, i) => (st.inlierMask[i] ? l.outer : NaN)));
    const outerT = outerSt.median;
    const innerT = outerT + st.median;
    sides[side] = {
      width: st.median, // px
      widthMM: st.median / PX_PER_MM,
      sigma: st.sigma, // 走査線ごとのばらつき (px)
      se: (1.2533 * st.sigma) / Math.sqrt(Math.max(1, st.n)), // 中央値の標準誤差 (px)
      n: st.n,
      total: r.lines.length,
      // 線の位置（補正画像の座標）
      outer: r.toImg(outerT),
      inner: r.toImg(innerT),
      // 走査線ごとの点（表示用）
      points: r.lines.map((l, i) => ({
        pos: l.pos,
        outer: Number.isFinite(l.outer) ? r.toImg(l.outer) : NaN,
        inner: Number.isFinite(l.inner) ? r.toImg(l.inner) : NaN,
        ok: st.inlierMask[i],
      })),
    };
  }
  return { sides, ...computeCentering(sides) };
}

/** ボーダー幅から左右・上下の比率と誤差を計算 */
export function computeCentering(sides) {
  const pair = (a, b) => {
    const A = sides[a], B = sides[b];
    const total = A.width + B.width;
    const pa = (100 * A.width) / total;
    // 誤差の伝播：比率 = A/(A+B)
    const stat = (100 * Math.sqrt((B.width * A.se) ** 2 + (A.width * B.se) ** 2)) / total ** 2;
    // 走査線のばらつきだけでは補正の微小なズレ等を表せないため、±0.2% を下限として上乗せ
    const err = Math.sqrt(stat ** 2 + SYSTEMATIC_ERR ** 2);
    return { first: pa, second: 100 - pa, worst: Math.max(pa, 100 - pa), err };
  };
  const lr = pair('left', 'right');
  const tb = pair('top', 'bottom');

  // 信頼度の判定
  const reasons = [];
  let level = 'high';
  const downgrade = (lv) => {
    if (lv === 'low' || (lv === 'medium' && level === 'high')) level = lv;
  };
  const names = { left: '左', right: '右', top: '上', bottom: '下' };
  for (const [k, s] of Object.entries(sides)) {
    if (!Number.isFinite(s.width) || s.width <= 2) {
      downgrade('low');
      reasons.push(`${names[k]}の内枠が見つかりませんでした`);
      continue;
    }
    const ratio = s.n / s.total;
    if (ratio < 0.5) {
      downgrade('low');
      reasons.push(`${names[k]}辺の測定がそろっていません（有効 ${s.n}/${s.total} 本）`);
    } else if (ratio < 0.75) {
      downgrade('medium');
      reasons.push(`${names[k]}辺で一部の走査線が外れ値でした（有効 ${s.n}/${s.total} 本）`);
    }
    if (s.sigma / s.width > 0.12) {
      downgrade('medium');
      reasons.push(`${names[k]}辺の幅のばらつきが大きめです（傾き・反り・反射の可能性）`);
    }
  }
  const err = Math.max(lr.err, tb.err);
  if (!Number.isFinite(err) || err > 1.0) {
    downgrade('low');
    reasons.push('推定誤差が ±1% を超えています');
  } else if (err > 0.5) {
    downgrade('medium');
  }
  return { lr, tb, worst: Math.max(lr.worst, tb.worst), err, confidence: { level, reasons } };
}
