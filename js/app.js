// 画面の操作と結果表示
import { analyze, rotateCorners, MARGIN, CARD_W, CARD_H, OUT_W, OUT_H } from './measure.js';
import { psaGrade } from './grading.js';

const $ = (id) => document.getElementById(id);
const state = {
  cv: null,
  face: 'front',
  src: null, // 元画像（cv.Mat）
  corners: null, // カードの四隅（元画像の座標）
  result: null,
  warpedCanvas: document.createElement('canvas'),
};

/* ---------- OpenCV の読み込み待ち ---------- */
// 注意：OpenCV のオブジェクトは then() を持つため、Promise にそのまま渡すと
// 無限ループになる。{ cv } のように包んで受け渡す。
function waitForOpenCV() {
  return new Promise((resolve) => {
    const check = () => {
      const cv = window.cv;
      if (cv && cv.Mat) return resolve({ cv });
      setTimeout(check, 100);
    };
    check();
  });
}

waitForOpenCV().then(({ cv }) => {
  state.cv = cv;
  $('file-input').disabled = false;
  $('upload-label').classList.remove('disabled');
  $('cv-status').textContent = 'スマホ写真・スキャン画像（JPEG / PNG など）';
});
$('upload-label').classList.add('disabled');

/* ---------- 表面 / 裏面 ---------- */
document.querySelectorAll('.segmented button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.face = btn.dataset.face;
    document.querySelectorAll('.segmented button').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    if (state.result) render();
  });
});

/* ---------- 画像の読み込み ---------- */
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !state.cv) return;
  setStatus('解析中…');
  try {
    const canvas = await fileToCanvas(file);
    if (state.src) state.src.delete();
    state.src = state.cv.imread(canvas);
    state.corners = null;
    run();
  } catch (err) {
    console.error(err);
    alert('画像を読み込めませんでした。別の画像でお試しください。');
  } finally {
    setStatus('スマホ写真・スキャン画像（JPEG / PNG など）');
    e.target.value = '';
  }
});

function setStatus(text) {
  $('cv-status').textContent = text;
}

/** 画像ファイル → canvas（長辺は最大 4000px。写真の向き情報も反映） */
async function fileToCanvas(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bmp.width, h = bmp.height;
  const s = Math.min(1, 4000 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/* ---------- 測定 ---------- */
function run() {
  const cv = state.cv;
  if (state.result && state.result.warped) state.result.warped.delete();
  const r = analyze(cv, state.src, state.corners);
  state.corners = r.corners;
  state.result = r;
  cv.imshow(state.warpedCanvas, r.warped);
  $('result-panel').classList.remove('hidden');
  render();
  $('result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('rotate-btn').addEventListener('click', () => {
  if (!state.corners) return;
  state.corners = rotateCorners(state.corners, 1);
  run();
});
$('again-btn').addEventListener('click', () => $('file-input').click());

/* ---------- 表示 ---------- */
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '--');

function render() {
  const r = state.result;
  const { lr, tb, err, confidence, sides } = r;

  $('lr-value').textContent = `${fmt(lr.first)} / ${fmt(lr.second)}`;
  $('tb-value').textContent = `${fmt(tb.first)} / ${fmt(tb.second)}`;
  $('lr-sub').textContent = `誤差 ±${fmt(lr.err)}%（${fmt(sides.left.widthMM)}mm : ${fmt(sides.right.widthMM)}mm）`;
  $('tb-sub').textContent = `誤差 ±${fmt(tb.err)}%（${fmt(sides.top.widthMM)}mm : ${fmt(sides.bottom.widthMM)}mm）`;

  // PSA 目安
  const faceName = state.face === 'back' ? '裏面' : '表面';
  if (Number.isFinite(r.worst)) {
    const g = psaGrade(r.worst, state.face, Number.isFinite(err) ? err : 0);
    $('grade-value').textContent = `${g.label}${g.grade < 10 ? ' 相当まで' : ''}`;
    let note = `${faceName}の最も偏った方向：${fmt(r.worst)}/${fmt(100 - r.worst)}`;
    if (g.limit) note += `（${g.grade}の基準 ${g.limit}/${100 - g.limit} 以内）`;
    if (g.nextGrade) note += `。${g.nextGrade}には ${g.nextLimit}/${100 - g.nextLimit} 以内が必要です。`;
    if (g.borderline) note += ' ⚠ 測定誤差の範囲内に基準の境目があります。';
    $('grade-note').textContent = note;
  } else {
    $('grade-value').textContent = '判定できません';
    $('grade-note').textContent = '';
  }

  // 信頼度
  const labels = { high: '高い', medium: 'ふつう', low: '低い（再撮影をおすすめします）' };
  const box = $('confidence');
  box.className = `confidence ${confidence.level}`;
  const reasons = [...confidence.reasons];
  if (!r.autoDetected) reasons.unshift('カードの輪郭を検出できなかったため、画像全体をカードとして測りました。');
  box.innerHTML =
    `測定の信頼度：<strong class="${confidence.level}">${labels[confidence.level]}</strong>` +
    (reasons.length ? `<ul>${reasons.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : '');
  if (confidence.level === 'low') {
    box.insertAdjacentHTML('beforeend', '<div class="small">暗い無地の背景・真上から・明るい場所で撮り直すか、スキャナーをお試しください。</div>');
  }

  // 詳細テーブル
  const names = { left: '左', right: '右', top: '上', bottom: '下' };
  $('detail-table').innerHTML =
    '<tr><th>辺</th><th>幅(mm)</th><th>幅(px)</th><th>ばらつき(px)</th><th>有効本数</th></tr>' +
    Object.entries(sides)
      .map(
        ([k, s]) =>
          `<tr><td>${names[k]}</td><td>${Number.isFinite(s.widthMM) ? s.widthMM.toFixed(2) : '--'}</td><td>${fmt(s.width)}</td><td>${fmt(s.sigma)}</td><td>${s.n}/${s.total}</td></tr>`
      )
      .join('');

  drawOverlay();
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** 補正後の画像に、外枠・内枠の線と走査点を重ねて描く */
function drawOverlay() {
  const r = state.result;
  const canvas = $('view-canvas');
  const scale = Math.min(1, 900 / OUT_H);
  canvas.width = Math.round(OUT_W * scale);
  canvas.height = Math.round(OUT_H * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(state.warpedCanvas, 0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);

  const { left, right, top, bottom } = r.sides;
  const x0 = MARGIN - 20, x1 = MARGIN + CARD_W + 20;
  const y0 = MARGIN - 20, y1 = MARGIN + CARD_H + 20;
  const line = (ax, ay, bx, by, color, w) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  const lw = 2 / scale;
  // 外枠
  line(left.outer, y0, left.outer, y1, '#22d3ee', lw);
  line(right.outer, y0, right.outer, y1, '#22d3ee', lw);
  line(x0, top.outer, x1, top.outer, '#22d3ee', lw);
  line(x0, bottom.outer, x1, bottom.outer, '#22d3ee', lw);
  // 内枠
  if (Number.isFinite(left.inner)) line(left.inner, y0, left.inner, y1, '#f472b6', lw);
  if (Number.isFinite(right.inner)) line(right.inner, y0, right.inner, y1, '#f472b6', lw);
  if (Number.isFinite(top.inner)) line(x0, top.inner, x1, top.inner, '#f472b6', lw);
  if (Number.isFinite(bottom.inner)) line(x0, bottom.inner, x1, bottom.inner, '#f472b6', lw);

  // 走査線ごとの検出点（除外した点は赤）
  const dot = (x, y, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3.5 / scale, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const [k, s] of Object.entries(r.sides)) {
    const horiz = k === 'left' || k === 'right';
    for (const p of s.points) {
      if (!Number.isFinite(p.inner)) continue;
      const color = p.ok ? 'rgba(244,114,182,0.9)' : '#ef4444';
      if (horiz) dot(p.inner, p.pos, color);
      else dot(p.pos, p.inner, color);
    }
  }
  ctx.restore();
}
