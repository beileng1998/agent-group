const CACHE_NAME = "agent-group-static-v2";
const PRECACHE = [
  "/manifest.webmanifest",
  "/agent-group-logo.svg",
  "/apple-touch-icon.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/pwa-maskable-icon-192.png",
  "/pwa-maskable-icon-512.png",
];
const PRIVATE_PREFIXES = ["/api/", "/attachments/", "/local-image", "/ws"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (PRIVATE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  const isVersionedAsset = url.pathname.startsWith("/assets/");
  const isPrecached = PRECACHE.includes(url.pathname);
  if (!isVersionedAsset && !isPrecached) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const refreshed = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached ?? refreshed;
    }),
  );
});
