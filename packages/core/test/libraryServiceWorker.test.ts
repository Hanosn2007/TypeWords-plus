import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../../../apps/nuxt/public/service-worker.js', import.meta.url), 'utf8')

function worker() {
  const handlers: Record<string, (event: any) => void> = {}
  const stored = new Map<string, Response>()
  const network = new Map<string, string>()
  const requests: string[] = []
  const urlOf = (request: any) => typeof request === 'string' ? request : request.url
  const cache = {
    match: async (request: any, options?: { ignoreSearch?: boolean }) => {
      const url = urlOf(request)
      const exact = stored.get(url)
      if (exact) return exact.clone()
      if (options?.ignoreSearch) {
        const target = new URL(url)
        for (const [key, response] of stored) {
          const cached = new URL(key)
          if (target.origin === cached.origin && target.pathname === cached.pathname) return response.clone()
        }
      }
    },
    put: async (request: any, response: Response) => { stored.set(urlOf(request), response.clone()) },
  }
  runInNewContext(source, {
    URL, Request, Response, console, caches: { open: async () => cache },
    fetch: async (request: any) => {
      const url = urlOf(request)
      requests.push(url)
      if (!network.has(url)) throw new Error('offline')
      return new Response(network.get(url))
    },
    self: { registration: { scope: 'https://example.test/' }, location: { origin: 'https://example.test' },
      clients: { claim: async () => {} }, addEventListener: (name: string, handler: any) => { handlers[name] = handler } },
  })
  function fetchPage(url: string, mode = 'navigate', method = 'GET'): Promise<Response> | undefined {
    let response: Promise<Response> | undefined
    handlers.fetch({ request: { url, mode, method }, respondWith: (promise: Promise<Response>) => { response = promise } })
    return response
  }
  async function cachePage(page: string, assets: string[]) {
    let pending: Promise<unknown> | undefined
    handlers.message({ data: { type: 'TYPEWORDS_CACHE_OPEN_PAGE', page, assets }, waitUntil: (promise: Promise<unknown>) => { pending = promise } })
    await pending
  }
  return { network, requests, stored, fetchPage, cachePage, handlers }
}

test('visited study document refreshes offline and hashed assets are reused', async () => {
  const w = worker()
  const page = 'https://example.test/practice-words/library-a'
  const asset = 'https://example.test/_nuxt/entry.abc.js'
  w.network.set(page, '<html>study</html>')
  w.network.set(asset, 'export const app = true')
  await w.cachePage(page, [asset])
  w.network.clear()
  assert.equal(await (await w.fetchPage(page + '?resume=1')!).text(), '<html>study</html>')
  const count = w.requests.length
  assert.equal(await (await w.fetchPage(asset, 'cors')!).text(), 'export const app = true')
  assert.equal(w.requests.length, count)
})

test('API, auth, write requests and third-party resources never use shell cache', () => {
  const w = worker()
  for (const url of [
    'https://example.test/api/library/books', 'https://example.test/api/sync/data',
    'https://example.test/login', 'https://example.test/admin/library', 'https://third.test/_nuxt/chunk.js',
  ]) assert.equal(w.fetchPage(url), undefined)
  assert.equal(w.fetchPage('https://example.test/words', 'navigate', 'POST'), undefined)
  assert.equal(w.stored.size, 0)
})

test('initial-page message caches only the opened study shell and same-origin Nuxt assets', async () => {
  const w = worker()
  const page = 'https://example.test/words'
  const asset = 'https://example.test/_nuxt/entry.abc.js'
  w.network.set(page, 'study')
  w.network.set(asset, 'asset')
  await w.cachePage(page, [asset, 'https://example.test/api/auth/me', 'https://third.test/_nuxt/x.js'])
  assert.deepEqual(w.requests.sort(), [asset, page].sort())
  await w.cachePage('https://example.test/login', [asset])
  assert.equal(w.requests.length, 2)
  assert.equal(w.handlers.install, undefined, 'updates should use the normal waiting lifecycle, without skipWaiting')
})

test('document requests prefer the network and update cached content without deleting old assets', async () => {
  const w = worker()
  const page = 'https://example.test/words'
  const asset = 'https://example.test/_nuxt/old.abc.js'
  w.network.set(page, 'old shell')
  w.network.set(asset, 'old asset')
  await w.cachePage(page, [asset])
  w.network.set(page, 'new shell')
  assert.equal(await (await w.fetchPage(page)!).text(), 'new shell')
  assert.equal(w.stored.has(asset), true)
  w.network.clear()
  assert.equal(await (await w.fetchPage(page)!).text(), 'new shell')
})

test('offline reload retains locale messages and visible local artwork', async () => {
  const w = worker()
  const page = 'https://example.test/practice-words/library-a'
  const assets = [
    'https://example.test/_i18n/build123/zh/messages.json',
    'https://example.test/imgs/logo/logo-text-black.png',
    'https://example.test/_ipx/_/imgs/empty.svg',
  ]
  w.network.set(page, 'study')
  for (const asset of assets) w.network.set(asset, asset.endsWith('.json') ? '{"words":"单词"}' : 'image')
  await w.cachePage(page, assets)
  w.network.clear()
  for (const asset of assets) assert.ok((await w.fetchPage(asset, 'cors'))?.ok)
  assert.equal(await (await w.fetchPage(assets[0], 'cors')!).text(), '{"words":"单词"}')
  assert.equal(w.fetchPage('https://example.test/_i18n/api/private'), undefined)
})
