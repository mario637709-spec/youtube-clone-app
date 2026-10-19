
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/cdn-proxy') {
    const targetUrl = url.searchParams.get('url');
    if (targetUrl) {
      event.respondWith(
        fetch(targetUrl, {
          mode: 'no-cors',
          credentials: 'omit',
          referrerPolicy: 'no-referrer'
        })
      );
    }
  }
});

