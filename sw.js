const APP_VERSION = '1.5.0';
const CACHE = 'resale-assistant-v' + APP_VERSION;
const ASSETS = ['./','./index.html','./styles.css?v=1.5.0','./app.js?v=1.5.0','./manifest.json?v=1.5.0','./icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if(event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if(event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});

async function networkFirst(request){
  const cache = await caches.open(CACHE);
  try{
    const fresh = await fetch(request, {cache:'no-store'});
    cache.put(request, fresh.clone());
    return fresh;
  }catch(err){
    const cached = await cache.match(request);
    if(cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  event.respondWith(networkFirst(event.request));
});
