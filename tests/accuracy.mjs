// 精度テスト：正解がわかっている人工カード画像を作って測定し、誤差を確認する
// 実行方法:  node tests/accuracy.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const p = join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e));
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => !!(window.cv && window.cv.Mat), null, { timeout: 60000 });

const cases = await page.evaluate(async () => {
  const cv = window.cv;
  const { analyze } = await import('/js/measure.js');
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  // 人工カードを描く（1mm = 20px）
  function drawCard(style, b) {
    const S = 20, W = 63 * S, H = 88 * S;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const R = 3 * S;
    g.beginPath();
    g.roundRect(0, 0, W, H, R);
    g.clip();
    const border = { yellow: '#f1cd38', silver: '#c8ccd2', back: '#2f6bc4' }[style];
    g.fillStyle = border;
    g.fillRect(0, 0, W, H);
    if (style === 'silver') {
      // 銀枠のうっすらしたグラデーション
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, 'rgba(255,255,255,0.25)');
      gr.addColorStop(0.5, 'rgba(0,0,0,0.05)');
      gr.addColorStop(1, 'rgba(255,255,255,0.2)');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    const x = b.l * S, y = b.t * S, w = W - (b.l + b.r) * S, h = H - (b.t + b.b) * S;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip(); // 絵柄は内枠の中だけに描く
    if (style === 'back') {
      g.fillStyle = '#16346f';
      g.fillRect(x, y, w, h);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(80,140,230,${0.2 + rnd() * 0.3})`;
        g.lineWidth = 10 + rnd() * 30;
        g.beginPath();
        g.arc(x + rnd() * w, y + rnd() * h, 50 + rnd() * 400, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#d33';
      g.beginPath(); g.arc(W / 2, H / 2, 200, Math.PI, 0); g.fill();
      g.fillStyle = '#eee';
      g.beginPath(); g.arc(W / 2, H / 2, 200, 0, Math.PI); g.fill();
    } else {
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, `hsl(${rnd() * 360},60%,55%)`);
      gr.addColorStop(1, `hsl(${rnd() * 360},60%,45%)`);
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `hsla(${rnd() * 360},70%,${30 + rnd() * 50}%,0.8)`;
        g.fillRect(x + rnd() * w, y + rnd() * h, rnd() * 300, rnd() * 300);
      }
      g.fillStyle = '#fff';
      g.font = `${5 * S}px sans-serif`;
      g.fillText('TEST CARD 123', x + 2 * S, y + 6 * S);
    }
    g.restore();
    return c;
  }

  // 撮影のシミュレーション：斜め・回転して暗い背景に置き、ぼかし・ノイズ・JPEG
  async function photograph(card, opts) {
    const src = cv.imread(card);
    const OW = 3000, OH = 4000;
    const cw = opts.size, ch = (cw * 88) / 63;
    const cx = OW / 2 + (rnd() - 0.5) * 300, cy = OH / 2 + (rnd() - 0.5) * 300;
    const a = (opts.rot * Math.PI) / 180;
    const base = [[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]];
    const dst = base.map(([px, py], i) => {
      // 台形（斜め撮影）
      const k = opts.keystone * (py < 0 ? -1 : 1);
      const qx = px * (1 + k);
      return [cx + qx * Math.cos(a) - py * Math.sin(a) + (rnd() - 0.5) * opts.jitter,
              cy + qx * Math.sin(a) + py * Math.cos(a) + (rnd() - 0.5) * opts.jitter];
    });
    const s = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, card.width, 0, card.width, card.height, 0, card.height]);
    const d = cv.matFromArray(4, 1, cv.CV_32FC2, dst.flat());
    const M = cv.getPerspectiveTransform(s, d);
    const out = new cv.Mat();
    const bg = opts.bg;
    // 透明部分（角の丸み）も背景色にするため、先に背景で埋めた画像に合成する
    cv.warpPerspective(src, out, M, new cv.Size(OW, OH), cv.INTER_AREA, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    const c = document.createElement('canvas');
    c.width = OW; c.height = OH;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, OW, OH);
    const tmp = document.createElement('canvas');
    cv.imshow(tmp, out);
    g.drawImage(tmp, 0, 0);
    if (opts.blur) { g.filter = `blur(${opts.blur}px)`; g.drawImage(c, 0, 0); g.filter = 'none'; }
    if (opts.noise) {
      const id = g.getImageData(0, 0, OW, OH);
      for (let i = 0; i < id.data.length; i += 4) {
        const n = (rnd() - 0.5) * opts.noise;
        id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n;
      }
      g.putImageData(id, 0, 0);
    }
    [src, s, d, M, out].forEach((m) => m.delete());
    const url = c.toDataURL('image/jpeg', 0.85);
    const img = new Image();
    img.src = url;
    await img.decode();
    const f = document.createElement('canvas');
    f.width = OW; f.height = OH;
    f.getContext('2d').drawImage(img, 0, 0);
    return f;
  }

  const results = [];
  const styles = ['yellow', 'silver', 'back'];
  for (let i = 0; i < 18; i++) {
    const style = styles[i % 3];
    const b = { l: 2.2 + rnd() * 2, r: 2.2 + rnd() * 2, t: 2.2 + rnd() * 2, b: 2.2 + rnd() * 2 };
    const card = drawCard(style, b);
    const photo = await photograph(card, {
      size: 1400 + rnd() * 900,
      rot: (rnd() - 0.5) * 30,
      keystone: (rnd() - 0.5) * 0.12,
      jitter: 40,
      blur: rnd() * 1.5,
      noise: 12,
      bg: ['#111', '#1b2433', '#222'][i % 3],
    });
    const src = cv.imread(photo);
    const t0 = performance.now();
    const r = analyze(cv, src, null);
    const ms = performance.now() - t0;
    const trueLR = (100 * b.l) / (b.l + b.r);
    const trueTB = (100 * b.t) / (b.t + b.b);
    results.push({
      style,
      trueLR: trueLR.toFixed(2), gotLR: r.lr.first.toFixed(2), errLR: (r.lr.first - trueLR).toFixed(2),
      trueTB: trueTB.toFixed(2), gotTB: r.tb.first.toFixed(2), errTB: (r.tb.first - trueTB).toFixed(2),
      estErr: r.err.toFixed(2), conf: r.confidence.level, auto: r.autoDetected, ms: Math.round(ms),
    });
    r.warped.delete();
    src.delete();
  }
  return results;
});

console.table(cases);
const errs = cases.flatMap((c) => [Math.abs(+c.errLR), Math.abs(+c.errTB)]);
const max = Math.max(...errs);
const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
console.log(`平均誤差 ${mean.toFixed(3)}%  最大誤差 ${max.toFixed(3)}%  → ${max <= 1 ? '合格（±1%以内）' : '不合格'}`);
await browser.close();
server.close();
process.exit(max <= 1 ? 0 : 1);
