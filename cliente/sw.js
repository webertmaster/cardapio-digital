const CACHE = 'cardapio-v2';
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

// Network-first para o app shell (sempre pega a versão mais nova quando
// online; só cai pro cache se a rede falhar, ex: offline de verdade).
// Dados do Supabase nunca passam por aqui, sempre vão direto pra rede.
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('supabase.co')) return;
  e.respondWith(
    fetch(e.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copia));
        return resposta;
      })
      .catch(() => caches.match(e.request))
  );
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================
self.addEventListener('push', (event) => {
  let dados = { titulo: 'Cardápio Digital', corpo: 'Você tem uma atualização.' };
  try { dados = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: dados.url || './index.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || './index.html';
  event.waitUntil(clients.openWindow(url));
});
