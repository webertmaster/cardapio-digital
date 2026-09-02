const CACHE = 'entregador-v1';
const ARQUIVOS = ['./index.html', './app.js', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first para o app shell — sempre pega a versão mais nova quando
// online; só cai pro cache se a rede falhar (offline de verdade).
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    fetch(e.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copia));
        return resposta;
      })
      .catch(() =>
        caches.match(e.request).then((resp) => resp || Response.error())
      )
  );
});
