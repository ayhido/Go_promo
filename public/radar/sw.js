// Service worker радара: push-уведомления и офлайн-оболочка
const SHELL = "radar-shell-v1";
const FILES = ["/radar/", "/radar/app.js", "/radar/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/radar/media/")) return;
  // сначала сеть, без сети — кэш
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok && FILES.includes(url.pathname)) caches.open(SHELL).then(c => c.put(e.request, r.clone()));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener("push", e => {
  let d = {};
  try {
    d = e.data.json();
  } catch {
    d = { title: "Радар заработка", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "Радар заработка", {
      body: d.body || "",
      icon: "/radar/icon-192.png",
      badge: "/radar/icon-192.png",
      tag: d.tag,
      data: { url: d.url || "/radar/" }
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/radar/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if (c.url.includes("/radar")) return c.navigate(url).then(w => w && w.focus());
      return self.clients.openWindow(url);
    })
  );
});
