import { get, set } from 'idb-keyval'
import type { Dict, DictResource } from '../types/types.ts'
import type { LibraryBookSummary, LibraryRelease } from '../types/library.ts'
import { getPracticeWordCacheLocal } from './cache.ts'
import { applyLibraryRelease, getPendingLibraryVersion, librarySummaryToResource } from './libraryContent.ts'
import { withAppBaseURL } from './base-url.ts'

const CATALOG_KEY = 'typewords-library-catalog-v1'
const releaseKey = (id: string, version: number) => `typewords-library-release-v1:${id}:${version}`
const latestKey = (id: string) => `typewords-library-latest-v1:${id}`

async function readLocal<T>(key: string): Promise<T | undefined> {
  try { return await get<T>(key) } catch { return undefined }
}

async function cacheLocal(key: string, value: unknown): Promise<void> {
  try { await set(key, value) } catch (error) { console.warn('共享词书离线缓存写入失败', error) }
}

async function requestJson<T>(url: string, envelope = false): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`词书请求失败 (${response.status})`)
    const result = await response.json()
    if (envelope && !result?.success) throw new Error(result?.msg || '词书请求失败')
    return envelope ? result.data : result
  } finally { clearTimeout(timeout) }
}

async function cachedCatalog<T>(key: string, url: string, envelope = false): Promise<T[]> {
  try {
    const data = await requestJson<T[]>(url, envelope)
    if (!Array.isArray(data)) throw new Error('词书目录格式无效')
    await cacheLocal(key, data)
    return data
  } catch (error) {
    const cached = await readLocal<T[]>(key)
    if (cached) return cached
    throw error
  }
}

/** Each source fails independently; either cached source can serve offline. */
export async function loadWordCatalog(officialUrl: string, recommended = false): Promise<DictResource[]> {
  const results = await Promise.allSettled([
    cachedCatalog<DictResource>(`typewords-official-catalog:${officialUrl}`, officialUrl),
    cachedCatalog<LibraryBookSummary>(CATALOG_KEY, withAppBaseURL('/api/library/books'), true),
  ])
  const official = results[0].status === 'fulfilled' ? results[0].value.flat() : []
  const shared = results[1].status === 'fulfilled' ? results[1].value : []
  if (results.every(result => result.status === 'rejected')) {
    throw new Error('词书目录暂时不可用，请联网后重试。已下载的词书可从学习列表打开。')
  }
  const library = shared.filter(book => !recommended || book.recommended)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(librarySummaryToResource)
  const seen = new Set<string>()
  return [...library, ...official].filter(book => {
    const id = String(book.id)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Historical releases are immutable. Never silently replace a requested version. */
export async function loadLibraryRelease(bookId: string, version?: number): Promise<LibraryRelease> {
  if (version != null) {
    const cached = await readLocal<LibraryRelease>(releaseKey(bookId, version))
    if (cached?.id === bookId && cached.version === version) return cached
  }
  try {
    const query = version == null ? '' : `?version=${version}`
    const release = await requestJson<LibraryRelease>(withAppBaseURL(`/api/library/books/${encodeURIComponent(bookId)}${query}`), true)
    if (release?.id !== bookId || !Number.isInteger(release.version) || release.version < 1 ||
      (version != null && release.version !== version) || !Array.isArray(release.content?.words) || !release.content.words.length) {
      throw new Error('共享词书版本格式无效')
    }
    await cacheLocal(releaseKey(bookId, release.version), release)
    // Loading a pinned old task must not lower the offline latest-version pointer.
    const previous = await readLocal<number>(latestKey(bookId))
    if (!previous || release.version > previous) await cacheLocal(latestKey(bookId), release.version)
    return release
  } catch (error) {
    if (version == null) {
      const latest = await readLocal<number>(latestKey(bookId))
      const cached = latest ? await readLocal<LibraryRelease>(releaseKey(bookId, latest)) : undefined
      if (cached) return cached
    }
    throw new Error(version == null
      ? '这本共享词书尚未下载，请联网后打开一次。'
      : `本轮需要词书第 ${version} 版，请联网下载后继续；原练习已保留。`, { cause: error })
  }
}

export async function loadLibraryBook(book: Dict, exactVersion?: number): Promise<Dict> {
  if (!book.library || book.custom) return book
  const cache = exactVersion == null ? await getPracticeWordCacheLocal(String(book.id)) : null
  const pinnedVersion = exactVersion ?? getPendingLibraryVersion(book, cache)
  const release = await loadLibraryRelease(book.library.bookId, pinnedVersion)
  return applyLibraryRelease(book, release)
}
