const CACHE_NAME = "weber-v2";
const APP_SHELL = ["/", "/leads", "/inbox", "/queue", "/settings"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && req.headers.get("accept")?.includes("text/html")) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Weber", body: "התראה חדשה", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      lang: "he",
      dir: "rtl",
      tag: data.tag || data.url,
      renotify: true,
      data: { url: data.url || "/" },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Prefer an already-open client at the same path — just focus it.
      const targetPath = new URL(url, self.location.origin).pathname;
      const sameRoute = wins.find((w) => {
        try {
          return new URL(w.url).pathname === targetPath;
        } catch {
          return false;
        }
      });
      if (sameRoute) {
        return sameRoute.focus();
      }
      // Otherwise focus an existing window and ask it to navigate via
      // postMessage. iOS PWA Safari ignores client.navigate(), so the
      // client-side router has to handle it.
      const anyClient = wins.find((w) => "focus" in w);
      if (anyClient) {
        anyClient.postMessage({ type: "navigate", url });
        return anyClient.focus();
      }
      // No window at all → open one fresh.
      return self.clients.openWindow(url);
    })
  );
});
