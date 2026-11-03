// Offline cache for the installed app. Bump VERSION on every deploy.
importScripts("features.js");
const VERSION = "swap-v25";
const FILES = ["./", "index.html", "core.css", "core.js", "data.js", "features.js", "ai.js", "cloud.js", "category.js", "swapmath.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-180.png", "vendor/qrcode.min.js",
  ...self.SWAP_FEATURES.flatMap(id => [`features/${id}.js`, `features/${id}.css`])];

// Private data is never cached: app/private/ (live.js, cloud-config.js, subscriptions.js, logos)
// and the cloud /api/live response go straight to the network, and are never stored offline.
const PRIVATE = u => /\/private\//.test(u.pathname) || /\/api\//.test(u.pathname);

self.addEventListener("install", e => e.waitUntil(
  caches.open(VERSION).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => caches.open(VERSION)).then(c => c.keys().then(reqs => Promise.all(reqs.filter(r => PRIVATE(new URL(r.url))).map(r => c.delete(r)))))
    .then(() => self.clients.claim())));

// Network first, revalidating past the HTTP cache so a deploy shows up at once.
// Only good same-origin responses are cached; offline falls back to the cache (and the app shell for links like ?open=deck).
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (PRIVATE(url)) return;   // not intercepted: the browser fetches it, nothing is cached
  const same = url.origin === location.origin;
  e.respondWith(fetch(e.request, same ? { cache: "no-cache" } : {}).then(r => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); e.waitUntil(caches.open(VERSION).then(c => c.put(e.request, copy))); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" })
    .then(m => m || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
