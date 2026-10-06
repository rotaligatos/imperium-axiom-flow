// Offline app shell only. Database/auth traffic (any other origin) is never cached,
// so nobody can be shown another person's data from cache.
const V = "iaf-shell-v23";
const SHELL = ["./", "index.html", "styles.css", "config.js", "js/app.js", "js/api.js", "js/sign.js", "js/admin.js", "js/employees.js", "js/p201.js", "js/schedules.js", "js/announcements.js", "js/shift.js", "js/timeadj.js", "js/org.js", "js/xlsxread.js", "js/logos.js", "js/sigpad.js", "js/atrf.js", "js/pdf.js", "js/pdfdata.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ch) => ch.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match("index.html"))));
});
