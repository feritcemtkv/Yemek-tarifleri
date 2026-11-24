/* Uygulama kabuğunu önbelleğe alır; tarif verisi (/api/) hiç önbelleğe alınmaz,
   uygulama son listeyi kendisi saklar. Dosyalar değişince SURUM'u artır. */
const SURUM = 'tariflerim-v10';
const KABUK = ['./', 'index.html', 'app.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SURUM).then((c) => c.addAll(KABUK.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(SURUM)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Kapak fotoğrafları: önce önbellek (çevrimdışı da görünsün). Videolar ve diğer API istekleri geçer.
  if (url.pathname.startsWith('/api/files/') && /\.(jpe?g|png|webp|heic|heif)$/i.test(url.pathname)) {
    e.respondWith(caches.open(SURUM + '-foto').then((c) => c.match(e.request).then((hit) => hit ||
      fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.pathname.includes('/api/')) return;
  // Önce ağ (güncel sürüm gelsin), olmazsa önbellek.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SURUM).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
