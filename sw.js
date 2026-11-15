// MyGolf Service Worker
// 新バージョンは自動で有効化しない（ラウンド進行中の差し替え防止）。
// 有効化は次回起動時（waiting のまま放置され、タブが閉じれば自然に切り替わる）。
const CACHE = 'mygolf-v23';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/db.js',
  './js/state.js',
  './js/master.js',
  './js/sync.js',
  './js/game.js',
  './js/export.js',
  './js/ui-setup.js',
  './js/ui-hole.js',
  './js/ui-restore.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
    // skipWaiting は呼ばない
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // GAS への通信はキャッシュしない
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
