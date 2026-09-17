// Bump when the shell caching policy changes. Keep previous caches while older
// tabs may still need their hashed assets; installing never interrupts a round.
const SHELL_CACHE_VERSION = 'v2';
const SHELL_CACHE = `typewords-study-shell-${SHELL_CACHE_VERSION}`;
const scopePath = new URL(self.registration.scope).pathname.replace(/\/?$/, '/');

function localPath(value) {
  const url = new URL(value, self.location.origin);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return null;
  return url.pathname.slice(scopePath.length);
}

function isAsset(value) {
  const path = localPath(value);
  return path !== null && (
    path.startsWith('_nuxt/') ||
    /^_i18n\/[^/]+\/[^/]+\/messages\.json$/.test(path) ||
    path.startsWith('imgs/logo/') || path.startsWith('_ipx/_/imgs/')
  );
}

function isStudyPage(value) {
  const path = localPath(value);
  return path !== null && /^(?:|words\/?|dict-list\/?|dict\/?|practice-words\/[^/]+\/?|words-test\/[^/]+\/?)$/.test(path);
}

async function cacheResponse(cache, request, response) {
  if (response.ok && response.type !== 'opaque') {
    try { await cache.put(request, response.clone()); }
    catch (error) { console.warn('Study shell cache unavailable', error); }
  }
  return response;
}

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // APIs, authentication, uploads and third-party resources never enter this cache.
  if (isAsset(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      return cacheResponse(cache, request, await fetch(request));
    })());
  } else if (request.mode === 'navigate' && isStudyPage(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try { return await cacheResponse(cache, request, await fetch(request)); }
      catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw error;
      }
    })());
  }
});

// Initial application chunks loaded before the first worker took control.
// The page registers only the visited shell and same-origin static app assets,
// including the separately loaded locale messages required to render the UI.
self.addEventListener('message', event => {
  if (event.data?.type !== 'TYPEWORDS_CACHE_OPEN_PAGE') return;
  const page = event.data.page;
  if (typeof page !== 'string' || !isStudyPage(page)) return;
  const assets = Array.isArray(event.data.assets) ? event.data.assets : [];
  const urls = [...new Set([page, ...assets.filter(url => typeof url === 'string' && isAsset(url))])];
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(urls.map(async url => {
      const request = new Request(url, { credentials: 'same-origin' });
      if (isAsset(url) && await cache.match(request)) return;
      await cacheResponse(cache, request, await fetch(request));
    }));
  })());
});
