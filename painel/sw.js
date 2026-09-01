// Service worker do Painel da Loja — cuida apenas do recebimento de push
// (novos pedidos). Não faz cache de app shell porque o painel é sempre
// usado online.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => { e.waitUntil(clients.claim()); });

self.addEventListener('push', (event) => {
  let dados = { titulo: 'Painel da Loja', corpo: 'Você tem uma atualização.' };
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
