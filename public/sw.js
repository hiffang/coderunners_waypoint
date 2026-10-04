/*
 * Waypoint service worker: the one shared app worker (owner: Member 3).
 *
 * - Precaches static, non-personalized mobile shells (/driver/shell, and
 *   /loader/shell once Member 2 adds it) plus the hashed /_next/static chunks
 *   and fonts they reference. Shells are fetched WITHOUT cookies, so a cached
 *   shell can never contain another account's data.
 * - Portal navigations (/driver/..., /loader/...) are network-first. Only when
 *   the network fails is the cached shell served, under the original URL; the
 *   shell then renders the signed-in account's IndexedDB snapshot.
 * - /api/* and every non-GET request pass straight through: private data is
 *   never stored here, mutations are never cached or replayed by the worker.
 */
const VERSION = "v1";
const SHELL_CACHE = `waypoint-shell-${VERSION}`;
const STATIC_CACHE = `waypoint-static-${VERSION}`;
const NAV_TIMEOUT_MS = 8000;
const SHELLS = [
  { prefix: "/driver", url: "/driver/shell" },
  { prefix: "/loader", url: "/loader/shell" },
];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Waypoint</title>
<style>body{font-family:system-ui,sans-serif;background:#ecece6;color:#14201a;margin:0;padding:24px}main{max-width:28rem;margin:10vh auto;background:#fff;border-radius:16px;padding:24px}</style></head>
<body><main><h1>You are offline</h1><p>This page has not been downloaded to this phone yet. Open the app once while connected and tap <b>Download for offline</b>.</p><p><a href="">Try again</a></p></main></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheShells()
      .catch(() => [])
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith("waypoint-") && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "refresh-shells") return;
  const port = event.ports && event.ports[0];
  event.waitUntil(
    precacheShells()
      .then((shells) => port && port.postMessage({ ok: shells.length > 0, shells }))
      .catch((err) => port && port.postMessage({ ok: false, shells: [], error: String(err) })),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    const shell = SHELLS.find((s) => url.pathname === s.prefix || url.pathname.startsWith(s.prefix + "/"));
    if (shell) event.respondWith(networkFirstNavigation(req, shell));
  }
});

async function networkFirstNavigation(req, shell) {
  try {
    return await withTimeout(fetch(req), NAV_TIMEOUT_MS);
  } catch {
    const cached = await (await caches.open(SHELL_CACHE)).match(shell.url);
    if (cached) return cached;
    return new Response(OFFLINE_HTML, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

/** Fetch each shell anonymously, cache it and every static asset it references. Returns cached shell URLs. */
async function precacheShells() {
  const shellCache = await caches.open(SHELL_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  const done = [];
  for (const shell of SHELLS) {
    let res;
    try {
      res = await withTimeout(fetch(shell.url, { cache: "no-store", credentials: "omit", redirect: "manual" }), 15000);
    } catch {
      continue;
    }
    if (!res.ok || res.type === "opaqueredirect") continue;
    const html = await res.clone().text();
    const assets = staticRefs(html, self.location.origin);
    const failed = await cacheAll(staticCache, assets);
    if (failed > 0) continue; // never advertise a shell whose chunks are missing
    await shellCache.put(shell.url, res);
    done.push(shell.url);
  }
  return done;
}

async function cacheAll(cache, urls) {
  let failed = 0;
  await Promise.all(
    urls.map(async (u) => {
      try {
        let res = await cache.match(u);
        if (!res) {
          res = await fetch(u, { credentials: "omit" });
          if (!res.ok) throw new Error(String(res.status));
          await cache.put(u, res.clone());
        }
        if (u.includes(".css")) {
          const css = await res.clone().text();
          const nested = cssRefs(css, u);
          const nestedFailed = await cacheAll(cache, nested.filter((n) => !urls.includes(n)));
          failed += nestedFailed;
        }
      } catch {
        failed++;
      }
    }),
  );
  return failed;
}

function staticRefs(html, origin) {
  const out = new Set();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\<>]+/g)) out.add(new URL(m[0], origin).href);
  return [...out];
}

function cssRefs(css, base) {
  const out = new Set();
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    if (m[1].startsWith("data:")) continue;
    const abs = new URL(m[1], base);
    if (abs.origin === self.location.origin && abs.pathname.startsWith("/_next/static/")) out.add(abs.href);
  }
  return [...out];
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
