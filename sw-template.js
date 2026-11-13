/*
 * Keeps the Kreisel for offline starts and quick returns. The page itself is
 * fetched fresh when there is a network (so a release shows up at once) and
 * from the cache when there is none; the hashed bundles never change and come
 * from the cache. The build fills in the version and the list of files.
 */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `kreisel-${VERSION}`;
// A file is the same whoever asks: a server's `Vary` (the preview sends `Vary: Origin`) must not hide it.
const MATCH = { cacheName: CACHE, ignoreVary: true };

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("kreisel-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put("./", copy));
          }
          return response;
        })
        .catch(() => caches.match("./", MATCH).then((cached) => cached ?? Response.error())),
    );
    return;
  }
  event.respondWith(caches.match(request, MATCH).then((cached) => cached ?? fetch(request)));
});
