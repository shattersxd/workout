// Офлайн-кэш Workout Routine. Лежит в корне рядом с index.html и регистрируется
// оттуда как 'sw.js' (blob-воркеры браузеры обычно не принимают).
//
// vendor/* - библиотеки с точной версией, не меняются: сначала кэш.
// Страница (index.html) - сначала сеть, но не дольше NETWORK_WAIT_MS: в зале
// связь бывает плохая, тогда сразу открываем сохранённую копию. После деплоя новая
// версия приходит при ближайшем открытии, когда сеть отвечает.
// Менять CACHE нужно только когда меняются файлы в vendor/.
const CACHE = "sila-v6";
const NETWORK_WAIT_MS = 3000;
const PRECACHE = [
  "./",
  "index.html",
  "vendor/react.production.min.js",
  "vendor/react-dom.production.min.js",
  "vendor/babel.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function store(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
}

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"));
}

function cacheFirst(req) {
  return caches.match(req).then(r => r || fetch(req).then(res => store(req, res)));
}

function networkFirst(req) {
  return new Promise(resolve => {
    let done = false;
    const finish = res => { if (!done && res) { done = true; resolve(res); } };
    // долго нет ответа - отдаём копию из кэша, а сеть пусть догружается в фоне
    const timer = setTimeout(() => { fromCache(req).then(finish); }, NETWORK_WAIT_MS);
    fetch(req)
      .then(res => { clearTimeout(timer); finish(store(req, res)); })
      .catch(() => {
        clearTimeout(timer);
        fromCache(req).then(r => { if (r) finish(r); else if (!done) { done = true; resolve(Response.error()); } });
      });
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(url.pathname.indexOf("/vendor/") >= 0 ? cacheFirst(req) : networkFirst(req));
});
