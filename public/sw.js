/* Dragons Delivery — service worker: Web Push + an offline screen for the installed app.
   Nothing is cached: menus, prices and order status must always be live. When a page
   navigation fails (no network) the app shows its own "Fără conexiune" screen instead of
   the browser's error page, and reloads by itself when the connection comes back. */

const OFFLINE_HTML = `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d0d1f"><title>Fără conexiune · Dragons</title>
<style>body{margin:0;min-height:100svh;display:flex;align-items:center;justify-content:center;
background:#0a0a14;color:#fff;font:16px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:24px}
b{font:700 28px Georgia,serif;color:#f5a623}h1{font-size:20px;margin:20px 0 6px}p{color:#ffffff99;margin:0 0 24px}
button{background:#c73050;color:#fff;border:0;border-radius:999px;padding:14px 28px;font:600 15px system-ui,sans-serif}</style>
</head><body><main><b>Dragons</b><h1>Fără conexiune la internet</h1>
<p>Verifică datele mobile sau Wi-Fi-ul. Reîncărcăm singuri când revine semnalul.</p>
<button onclick="location.reload()">Încearcă din nou</button></main>
<script>addEventListener("online",()=>location.reload())</script></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Dragons Delivery";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/" },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url) && "focus" in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
