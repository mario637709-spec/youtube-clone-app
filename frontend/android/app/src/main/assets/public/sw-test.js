
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === '/video-test') {
    const targetUrl = url.searchParams.get('url');
    event.respondWith(
      fetch(targetUrl, {
        mode: 'no-cors',
        credentials: 'omit'
      })
    );
  }
});

