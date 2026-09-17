import assert from 'node:assert/strict'
import test, { beforeEach, after } from 'node:test'
import { registerHooks } from 'node:module'

// Exercise the real fetch/cache/version path with an isolated key-value store.
// Browser IndexedDB persistence is verified separately in the app smoke test.
const storage = new Map<string, unknown>()
;(globalThis as any).__typewordsLibraryCacheTest = storage
const storageModule = 'data:text/javascript,' + encodeURIComponent(`
  export const get = async key => globalThis.__typewordsLibraryCacheTest.get(key);
  export const set = async (key, value) => { globalThis.__typewordsLibraryCacheTest.set(key, structuredClone(value)); };
`)
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'idb-keyval' ? { url: storageModule, shortCircuit: true } : next(specifier, context)
} })
const { loadLibraryBook, loadLibraryRelease, loadWordCatalog } = await import('../src/utils/libraryBooks.ts')
const fetchOriginal = globalThis.fetch
const responses = new Map<string, unknown>()
const requests: string[] = []
beforeEach(() => {
  storage.clear(); responses.clear(); requests.length = 0
  globalThis.fetch = (async (url: string) => {
    requests.push(String(url))
    if (!responses.has(String(url))) throw new Error('offline')
    return Response.json(responses.get(String(url)))
  }) as typeof fetch
})
after(() => { globalThis.fetch = fetchOriginal; hooks.deregister(); delete (globalThis as any).__typewordsLibraryCacheTest })

const release = (version: number) => ({
  id: 'library-a', version, updatedAt: '', content: {
    name: `Book ${version}`, description: '', language: 'en', translateLanguage: 'zh-CN',
    category: '课程', tags: [], recommended: true, sortOrder: 0, units: [],
    words: [{ word: 'alpha', trans: [{ pos: 'n.', cn: `v${version}` }] }],
  },
})
const success = (data: unknown) => ({ success: true, code: 0, data })
const book = (): any => ({
  id: 'library-a', library: { bookId: 'library-a', version: 1 }, words: [], statistics: [],
  perDayStudyNumber: 20, lastLearnIndex: 0, custom: false,
})

test('exact releases are cached independently and loading an old version never downgrades offline latest', async () => {
  responses.set('/api/library/books/library-a?version=1', success(release(1)))
  responses.set('/api/library/books/library-a', success(release(2)))
  await loadLibraryRelease('library-a', 1)
  await loadLibraryRelease('library-a')
  responses.clear()
  const count = requests.length
  assert.equal((await loadLibraryRelease('library-a', 1)).version, 1)
  assert.equal(requests.length, count)
  assert.equal((await loadLibraryRelease('library-a')).version, 2)
})

test('pending v1 task keeps its old definition offline; a completed task upgrades to v2', async () => {
  responses.set('/api/library/books/library-a?version=1', success(release(1)))
  responses.set('/api/library/books/library-a', success(release(2)))
  await loadLibraryRelease('library-a', 1)
  await loadLibraryRelease('library-a')
  const cache = { dictId: 'library-a', libraryVersion: 1, taskWordsStr: { new: ['alpha'], review: [] }, statStoreData: { startDate: 42 } }
  storage.set('PracticeSaveWord', { version: 1, val: { schemaVersion: 2, entries: { 'library-a': { data: cache, updatedAt: '2026-01-01' } } } })
  responses.clear()
  const original = await loadLibraryBook(book())
  assert.equal(original.library?.version, 1)
  assert.equal(original.words[0].trans[0].cn, 'v1')
  original.learning!.lastCompletedPracticeAt = 42
  responses.set('/api/library/books/library-a', success(release(2)))
  const upgraded = await loadLibraryBook(original)
  assert.equal(upgraded.library?.version, 2)
  assert.equal(upgraded.words[0].trans[0].cn, 'v2')
})

test('missing pinned release never uses cached newer content or deletes the pending task', async () => {
  responses.set('/api/library/books/library-a', success(release(2)))
  await loadLibraryRelease('library-a')
  responses.clear()
  storage.set('PracticeSaveWord', { version: 1, val: { dictId: 'library-a', libraryVersion: 1, taskWords: { new: [{ word: 'alpha' }], review: [] } } })
  const saved = structuredClone(storage.get('PracticeSaveWord'))
  await assert.rejects(() => loadLibraryBook(book()), /第 1 版.*原练习已保留/)
  assert.deepEqual(storage.get('PracticeSaveWord'), saved)
})

test('shared and official catalogues fail independently and both remain available from cache', async () => {
  const shared = { ...release(1).content, id: 'library-a', version: 1, length: 1, updatedAt: '' }
  responses.set('/api/library/books', success([shared]))
  assert.deepEqual((await loadWordCatalog('/official')).map(item => item.id), ['library-a'])
  responses.clear()
  responses.set('/official', [{ id: 1, name: 'Official' }])
  assert.deepEqual((await loadWordCatalog('/official')).map(item => item.id), ['library-a', 1])
  responses.clear()
  assert.deepEqual((await loadWordCatalog('/official')).map(item => item.id), ['library-a', 1])
})

test('recommendations use the shared recommendation flag while catalogue contains every release', async () => {
  const first = { ...release(1).content, id: 'library-a', version: 1, length: 1, updatedAt: '' }
  const second = { ...first, id: 'library-b', recommended: false }
  responses.set('/api/library/books', success([first, second]))
  responses.set('/recommended', [])
  assert.deepEqual((await loadWordCatalog('/recommended', true)).map(item => item.id), ['library-a'])
  assert.deepEqual((await loadWordCatalog('/recommended')).map(item => item.id), ['library-a', 'library-b'])
})
