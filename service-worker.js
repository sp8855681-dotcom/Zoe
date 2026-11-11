const CACHE_NAME = "zoe-app-shell-v1";
const appScope = self.registration.scope;
const homeUrl = new URL("./", appScope);
const chatUrl = new URL("chat.html", appScope);
const APP_SHELL = [
  homeUrl.href,
  chatUrl.href,
  "styles.css",
  "app.js",
  "chat.js",
  "web-auth.js",
  "pwa.js",
  "manifest.webmanifest",
  "icons/zoe.svg",
].map((path) => new URL(path, appScope).href);
const STATIC_ASSETS = new Set(APP_SHELL.filter((url) => url !== homeUrl.href && url !== chatUrl.href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("zoe-app-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin
    || url.pathname.startsWith(new URL("v1/", appScope).pathname)
    || url.pathname === new URL("health", appScope).pathname
    || url.pathname.startsWith(new URL("api/", appScope).pathname)) return;

  if (STATIC_ASSETS.has(url.href)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
    return;
  }

  if (url.href === homeUrl.href || url.href === chatUrl.href) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error("Zoe is offline and this page is not cached.");
      }),
    );
  }
});
