/*
 * 買取SAIKOU Manager Service Worker
 * - 業務データ（API・HTML）はキャッシュしない（機密情報を端末に残さないため）
 * - 静的アセット（/_next/static, アイコン）のみキャッシュ
 * - オフライン時はオフライン案内を表示
 */
const CACHE = "saikou-static-v1";
const OFFLINE_HTML = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>オフライン</title><body style="font-family:sans-serif;background:#0b1730;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">
<div><p style="color:#e0bd5f;font-weight:bold">買取SAIKOU Manager</p><p>インターネットに接続されていません。<br>接続を確認して再読み込みしてください。</p></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon") || url.pathname.startsWith("/apple-icon")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
  }
});
