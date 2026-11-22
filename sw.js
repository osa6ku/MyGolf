// MyGolf Service Worker
// 新バージョンは自動で有効化しない（ラウンド進行中の差し替え防止）。
// 有効化は次回起動時か、アプリ内バナーの「更新する」（SKIP_WAITING）から。
const CACHE = 'mygolf-v55';
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
  './js/book.js',
  './js/books.js',
  './js/history.js',
  './js/ui-setup.js',
  './js/ui-hole.js',
  './js/ui-restore.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    // プリキャッシュも HTTP キャッシュを再検証してから入れる（古い版の混入防止）
    caches.open(CACHE).then(cache =>
      cache.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' }))))
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

// アプリの「更新する」ボタンからの明示指示でのみ即時有効化する
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // GAS への通信はキャッシュしない
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(
    // HTTP キャッシュ（GitHub Pages は max-age=600）を毎回再検証し、古い版を掴まない
    fetch(event.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
