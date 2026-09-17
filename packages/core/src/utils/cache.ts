import type { PracticeData, TaskWords, WordPracticeMode, WordPracticeStage, WordPracticeType } from '../types'
import type { PracticeState } from '../stores'
import { get, set } from 'idb-keyval'

type CacheConfig = { key: string; version: number }

const practiceWordCacheListeners = new Set<() => void>()
/** Notify views after a successful local write, including imports and remote merges. */
export function subscribePracticeWordCache(listener: () => void): () => void {
  practiceWordCacheListeners.add(listener)
  return () => { practiceWordCacheListeners.delete(listener) }
}

export const PRACTICE_WORD_CACHE: CacheConfig = {
  key: 'PracticeSaveWord',
  // The payload itself has schemaVersion: 2. Keep this sync-row version at 1
  // so existing v1 cloud rows still participate in timestamp comparison and
  // can be migrated into the bundle on first use.
  version: 1,
}
export const PRACTICE_ARTICLE_CACHE: CacheConfig = {
  key: 'PracticeSaveArticle',
  version: 1,
}

export type PracticeWordCache = {
  dictId?: string
  libraryVersion?: number
  practiceType?: WordPracticeType
  practiceMode?: WordPracticeMode
  taskWords: TaskWords
  practiceData?: PracticeData
  statStoreData?: PracticeState
  skipCheckpoint?: PracticeStageCheckpoint | null
}

export type PracticeStageCheckpoint = {
  stage: WordPracticeStage
  practiceType: WordPracticeType
  practiceData: PracticeData
}

export type PracticeWordTaskWordsStr = Omit<TaskWords, 'new' | 'review'> & {
  new: string[]
  review: string[]
}

export type PracticeWordDataCompact = Omit<PracticeData, 'words' | 'wrongWords'> & {
  wordsStr: string[]
  wrongWordsStr: string[]
}

export type PracticeStageCheckpointCompact = Omit<PracticeStageCheckpoint, 'practiceData'> & {
  practiceData: PracticeWordDataCompact
}

export type PracticeWordCacheCompact = {
  dictId?: string
  libraryVersion?: number
  practiceType?: WordPracticeType
  practiceMode?: WordPracticeMode
  taskWordsStr: PracticeWordTaskWordsStr
  practiceData: PracticeWordDataCompact
  statStoreData: PracticeState
  skipCheckpoint?: PracticeStageCheckpointCompact | null
}

export type PracticeWordCacheStored = PracticeWordCache | PracticeWordCacheCompact

/**
 * The cloud has one generic `practice_word` row. Keep dictionary-level clocks
 * inside that row so updating dictionary B cannot replace dictionary A's
 * unfinished session on another device.
 */
export type PracticeWordCacheBundleEntry = {
  data: PracticeWordCacheStored | null
  updatedAt: string
}

export type PracticeWordCacheBundle = {
  schemaVersion: 2
  entries: Record<string, PracticeWordCacheBundleEntry>
  /** Old caches without a dictId cannot be assigned to a dictionary safely. */
  unresolvedLegacy?: PracticeWordCacheBundleEntry
}

export type PracticeWordCachePayload = PracticeWordCacheStored | PracticeWordCacheBundle | null

export type PracticeArticleCache = {
  practiceData: {
    sectionIndex: number
    sentenceIndex: number
    wordIndex: number
  }
  statStoreData: PracticeState
}

export type LocalCacheResult<T> = { val: T; updated_at?: string; version: number }

/**
 * 尝试从 localStorage 迁移老数据到 IndexedDB。
 * 如果 idb 中无数据，但 localStorage 中有，则迁移并删除 localStorage 中的 key。
 * 老数据是 JSON 字符串格式，迁移时解析为对象再存入 idb。
 */
async function migrateFromLocalStorage<T>(config: CacheConfig): Promise<LocalCacheResult<T> | null> {
  try {
    const raw = localStorage.getItem(config.key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalCacheResult<T>
    // 迁移到 idb
    await set(config.key, raw)
    // 删除 localStorage 中的老数据
    localStorage.removeItem(config.key)
    console.log(`[cache] migrated ${config.key} from localStorage to idb`)
    return parsed
  } catch {
    return null
  }
}

/** 从 idb 读取带 meta 的缓存；无数据或解析失败返回 null */
async function getLocalWithMeta<T>(config: CacheConfig): Promise<LocalCacheResult<T> | null> {
  const raw = await get(config.key)
  if (raw) {
    // 兼容旧版本写入的 JSON 字符串格式
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as LocalCacheResult<T>
      } catch {
        return null
      }
    }
    return raw as LocalCacheResult<T>
  }
  // idb 中没有数据，尝试从 localStorage 迁移（兼容老数据）
  return migrateFromLocalStorage<T>(config)
}

async function getLocal<T>(config: CacheConfig): Promise<T | null> {
  const result = await getLocalWithMeta<T>(config)
  if (result?.val) {
    if (Object.keys(result.val).length > 0) return result.val
  }
  return null
}

async function setLocal<T>(config: CacheConfig, val: T | null, updated_at: string): Promise<void> {
  // idb 原生支持对象存储，直接存对象，无需 JSON.stringify
  const payload: LocalCacheResult<T> = {
    version: config.version,
    val,
    updated_at,
  }
  await set(config.key, JSON.stringify(payload))
  if (config.key === PRACTICE_WORD_CACHE.key) {
    for (const listener of practiceWordCacheListeners) {
      try { listener() } catch (error) { console.warn('练习统计刷新失败', error) }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isPracticeWordCacheBundle(value: unknown): value is PracticeWordCacheBundle {
  return isRecord(value) && value.schemaVersion === 2 && isRecord(value.entries)
}

function getCacheDictId(cache: PracticeWordCacheStored): string | null {
  return typeof cache.dictId === 'string' && cache.dictId.length > 0 ? cache.dictId : null
}

function newerEntry(
  local: PracticeWordCacheBundleEntry | undefined,
  remote: PracticeWordCacheBundleEntry | undefined
): PracticeWordCacheBundleEntry | undefined {
  if (!local) return remote
  if (!remote) return local
  // A tie favors local data so an in-flight save is not discarded.
  const localTime = Date.parse(local.updatedAt)
  const remoteTime = Date.parse(remote.updatedAt)
  if (Number.isNaN(remoteTime)) return local
  if (Number.isNaN(localTime)) return remote
  return localTime >= remoteTime ? local : remote
}

export function normalizePracticeWordCacheBundle(
  payload: PracticeWordCachePayload | undefined,
  fallbackUpdatedAt?: string
): PracticeWordCacheBundle | null {
  if (!payload) return null
  if (isPracticeWordCacheBundle(payload)) {
    return {
      schemaVersion: 2,
      entries: { ...payload.entries },
      ...(payload.unresolvedLegacy ? { unresolvedLegacy: payload.unresolvedLegacy } : {}),
    }
  }

  const updatedAt = fallbackUpdatedAt ?? new Date(0).toISOString()
  const entry: PracticeWordCacheBundleEntry = { data: payload, updatedAt }
  const dictId = getCacheDictId(payload)
  return dictId
    ? { schemaVersion: 2, entries: { [dictId]: entry } }
    : { schemaVersion: 2, entries: {}, unresolvedLegacy: entry }
}

export function mergePracticeWordCacheBundles(
  localPayload: PracticeWordCachePayload | undefined,
  remotePayload: PracticeWordCachePayload | undefined,
  localUpdatedAt?: string,
  remoteUpdatedAt?: string
): PracticeWordCacheBundle | null {
  const local = normalizePracticeWordCacheBundle(localPayload, localUpdatedAt)
  const remote = normalizePracticeWordCacheBundle(remotePayload, remoteUpdatedAt)
  if (!local) return remote
  if (!remote) return local

  const entries: Record<string, PracticeWordCacheBundleEntry> = {}
  for (const dictId of new Set([...Object.keys(remote.entries), ...Object.keys(local.entries)])) {
    const entry = newerEntry(local.entries[dictId], remote.entries[dictId])
    if (entry) entries[dictId] = entry
  }
  const unresolvedLegacy = newerEntry(local.unresolvedLegacy, remote.unresolvedLegacy)
  return {
    schemaVersion: 2,
    entries,
    ...(unresolvedLegacy ? { unresolvedLegacy } : {}),
  }
}

export function getPracticeWordCacheFromPayload(
  payload: PracticeWordCachePayload | undefined,
  dictId?: string
): PracticeWordCacheStored | null {
  if (!payload) return null
  if (isPracticeWordCacheBundle(payload)) {
    if (!dictId) return null
    return payload.entries[dictId]?.data ?? null
  }
  if (!dictId || payload.dictId == null || String(payload.dictId) === String(dictId)) return payload
  return null
}

/** Read one dictionary's session. Use getPracticeWordCacheBundleLocal for the complete sync payload. */
export async function getPracticeWordCacheLocal(dictId?: string): Promise<PracticeWordCacheStored | null> {
  return getPracticeWordCacheFromPayload(await getLocal<PracticeWordCachePayload>(PRACTICE_WORD_CACHE), dictId)
}

export async function getPracticeWordCacheBundleLocal(): Promise<PracticeWordCacheBundle | null> {
  const result = await getLocalWithMeta<PracticeWordCachePayload>(PRACTICE_WORD_CACHE)
  return normalizePracticeWordCacheBundle(result?.val, result?.updated_at)
}

/** Raw payload plus the outer row clock, used only by generic sync plumbing. */
export async function getPracticeWordCacheLocalWithMeta(): Promise<LocalCacheResult<PracticeWordCachePayload> | null> {
  return getLocalWithMeta<PracticeWordCachePayload>(PRACTICE_WORD_CACHE)
}

export async function setPracticeWordCacheLocal(cache: PracticeWordCachePayload, updated_at?: string): Promise<void> {
  await setLocal(PRACTICE_WORD_CACHE, cache, updated_at)
}

export async function setPracticeWordCacheBundleLocal(
  cache: PracticeWordCacheBundle | null,
  updated_at?: string
): Promise<void> {
  await setLocal(PRACTICE_WORD_CACHE, cache, updated_at)
}

export async function getPracticeArticleCacheLocal(): Promise<PracticeArticleCache | null> {
  return getLocal<PracticeArticleCache>(PRACTICE_ARTICLE_CACHE)
}

export async function getPracticeArticleCacheLocalWithMeta(): Promise<LocalCacheResult<PracticeArticleCache> | null> {
  return getLocalWithMeta<PracticeArticleCache>(PRACTICE_ARTICLE_CACHE)
}

export async function setPracticeArticleCacheLocal(
  cache: PracticeArticleCache | null,
  updated_at?: string
): Promise<void> {
  await setLocal(PRACTICE_ARTICLE_CACHE, cache, updated_at)
}
