import { useBaseStore } from '../stores'
import { Toast } from '@typewords/base'
import { isCompletedPracticeCache, normalizeLearningWord } from '../utils/bookLearning'
import type { PracticeState } from '../stores/practice'
import { SyncDataType } from '../types'
import type { PracticeData, TaskWords, Word } from '../types'
import type {
  PracticeArticleCache,
  PracticeStageCheckpoint,
  PracticeStageCheckpointCompact,
  PracticeWordCache,
  PracticeWordCacheBundle,
  PracticeWordCacheCompact,
  PracticeWordCachePayload,
  PracticeWordCacheStored,
} from '../utils/cache'
import {
  getPracticeArticleCacheLocal,
  getPracticeWordCacheBundleLocal,
  getPracticeWordCacheFromPayload,
  getPracticeWordCacheLocalWithMeta,
  isPracticeWordCacheBundle,
  mergePracticeWordCacheBundles,
  setPracticeWordCacheBundleLocal,
} from '../utils/cache'
import { useDataSyncPersistence } from './useDataSyncPersistence'
import { getPracticeTimeDays, stripPracticeTimeAccounting } from '../utils/practiceTime'
import { loadLibraryBook } from '../utils/libraryBooks'

type PendingWordSync = {
  data: PracticeWordCacheBundle | null
  updatedAt: string
  push: (data: PracticeWordCacheBundle | null, updatedAt: string, keepalive?: boolean) => Promise<boolean>
}

const WORD_SYNC_DELAY = 1000
const WORD_SYNC_RETRY_DELAY = 10_000
let pendingWordSync: PendingWordSync | null = null
let wordSyncTimer: ReturnType<typeof setTimeout> | null = null
let wordSyncRunning = false
let wordLocalWriteQueue: Promise<void> = Promise.resolve()

function scheduleWordSyncTimer(delay: number) {
  if (wordSyncTimer) return
  wordSyncTimer = setTimeout(() => {
    wordSyncTimer = null
    void flushWordRemoteSync()
  }, delay)
}

function scheduleWordRemoteSync(sync: PendingWordSync) {
  pendingWordSync = sync
  scheduleWordSyncTimer(WORD_SYNC_DELAY)
}

async function waitForRunningWordSync() {
  while (wordSyncRunning) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function flushWordRemoteSync(keepalive: boolean = false) {
  if (wordSyncRunning || !pendingWordSync) return
  if (wordSyncTimer) {
    clearTimeout(wordSyncTimer)
    wordSyncTimer = null
  }
  const current = pendingWordSync
  pendingWordSync = null
  wordSyncRunning = true
  let retry = false
  try {
    const success = await current.push(current.data, current.updatedAt, keepalive)
    if (!success && !pendingWordSync) {
      pendingWordSync = current
      retry = true
    }
  } finally {
    wordSyncRunning = false
    if (pendingWordSync) {
      scheduleWordSyncTimer(retry && pendingWordSync === current ? WORD_SYNC_RETRY_DELAY : 0)
    }
  }
}

/**
 * 将进行中的练习统计（PracticeState）落库到 store.sdict.statistics。
 * 用于切换词典或修改练习设置前调用，避免学习记录丢失。
 * @param st - 来自缓存或内存的 PracticeState，为 null / spend=0 时直接返回
 */
export function flushStatToStore(st: PracticeState | null | undefined): void {
  const days = getPracticeTimeDays(st)
  if (!st || !days.length) return
  const store = useBaseStore()

  const baseInfo = {
    total: st.total,
    wrong: st.wrong,
    new: st.newWordNumber,
    review: st.reviewWordNumber,
    skipped: st.skippedWordNumber ?? 0,
  }

  if (days.length === 1) {
    const day = days[0]
    store.sdict.statistics.push({
      ...baseInfo,
      spend: day.spend,
      startDate: day.startDate,
      ...(day.segments.length ? { segments: day.segments } : {}),
      sessionRole: 'single',
    })
    return
  }

  days.forEach((day, index) => {
    const sessionRole = index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'
    store.sdict.statistics.push({
      ...baseInfo,
      spend: day.spend,
      startDate: day.startDate,
      segments: day.segments,
      sessionRole,
    })
  })
}

function isCompactPracticeWordCache(data: PracticeWordCacheStored | null): data is PracticeWordCacheCompact {
  return !!data && 'taskWordsStr' in data
}

function createWordMap(dictId?: string): Map<string, Word> {
  const store = useBaseStore()
  const book = store.word.bookList.find(book => String(book.id) === String(dictId)) ?? store.sdict
  return new Map(book.words.map(word => [book.units?.length ? normalizeLearningWord(word.word) : word.word, word]))
}

function restoreWords(words: string[], wordMap: Map<string, Word>): Word[] {
  return words.map(word => wordMap.get(word) ?? wordMap.get(normalizeLearningWord(word))).filter((word): word is Word => !!word)
}

function serializePracticeData(data: PracticeData): PracticeWordCacheCompact['practiceData'] {
  const { words, wrongWords, ...rest } = data
  return {
    ...rest,
    wordsStr: words.map(v => v.word),
    wrongWordsStr: wrongWords.map(v => v.word),
  }
}

function restorePracticeData(data: PracticeWordCacheCompact['practiceData'], wordMap: Map<string, Word>): PracticeData {
  const words = restoreWords(data.wordsStr ?? [], wordMap)
  const wrongWords = restoreWords(data.wrongWordsStr ?? [], wordMap)
  return {
    ...data,
    index: words.length ? Math.min(data.index, words.length - 1) : 0,
    words,
    wrongWords,
  }
}

function serializeSkipCheckpoint(
  checkpoint: PracticeStageCheckpoint | null | undefined
): PracticeStageCheckpointCompact | null {
  if (!checkpoint) return null
  return {
    stage: checkpoint.stage,
    practiceType: checkpoint.practiceType,
    practiceData: serializePracticeData(checkpoint.practiceData),
  }
}

function serializePracticeWordCache(data: PracticeWordCache | null, unifiedTiming: boolean = false): PracticeWordCacheStored | null {
  if (!data) return null
  const book = useBaseStore().word.bookList.find(book => String(book.id) === String(data.dictId))
  // Nuxt writes its accounting marker while the unified timer is active. The
  // same shared persistence is used by VS Code, whose legacy timer must not
  // re-save a restored Nuxt baseline into its next round.
  const statStoreData = !unifiedTiming && data.statStoreData
    ? stripPracticeTimeAccounting(data.statStoreData)
    : data.statStoreData
  return {
    dictId: data.dictId,
    ...(book?.library ? { libraryVersion: data.libraryVersion ?? data.taskWords.libraryVersion ?? book.library.version } : {}),
    practiceType: data.practiceType,
    practiceMode: data.practiceMode,
    taskWordsStr: {
      ...Object.fromEntries(Object.entries(data.taskWords).filter(([key]) => key !== 'new' && key !== 'review')),
      new: data.taskWords.new.map(v => v.word),
      review: data.taskWords.review.map(v => v.word),
    },
    practiceData: serializePracticeData(data.practiceData),
    statStoreData,
    skipCheckpoint: serializeSkipCheckpoint(data.skipCheckpoint),
  }
}

async function restorePracticeWordCache(data: PracticeWordCacheStored | null): Promise<PracticeWordCache | null> {
  if (!data) return null
  const store = useBaseStore()
  const book = data.dictId ? store.word.bookList.find(book => String(book.id) === String(data.dictId)) : store.sdict
  if (book && isCompletedPracticeCache(book, data)) return null
  if (book?.library && data.libraryVersion) {
    try { Object.assign(book, await loadLibraryBook(book, data.libraryVersion)) }
    catch (error) { Toast.error(error instanceof Error ? error.message : '原词书版本加载失败，练习已保留。'); throw error }
  }
  if (!isCompactPracticeWordCache(data)) {
    if (!data.taskWords?.new.length && !data.taskWords?.review.length) return null
    return data
  }
  if (!data.taskWordsStr?.new.length && !data.taskWordsStr?.review.length) return null
  const wordMap = createWordMap(data.dictId)
  const taskWords: TaskWords = {
    ...Object.fromEntries(Object.entries(data.taskWordsStr).filter(([key]) => key !== 'new' && key !== 'review')),
    new: restoreWords(data.taskWordsStr.new, wordMap),
    review: restoreWords(data.taskWordsStr.review, wordMap),
  }

  const practiceData = restorePracticeData(data.practiceData, wordMap)
  if (typeof taskWords.unitId === 'string' && (
    taskWords.new.length !== data.taskWordsStr.new.length ||
    taskWords.review.length !== data.taskWordsStr.review.length ||
    practiceData.words.length !== data.practiceData.wordsStr.length
  )) {
    Toast.warning('词书内容已变化，原练习无法完整恢复。进度未推进，请重新开始本轮。')
    return null
  }
  const skipCheckpoint = data.skipCheckpoint
    ? {
        stage: data.skipCheckpoint.stage,
        practiceType: data.skipCheckpoint.practiceType,
        practiceData: restorePracticeData(data.skipCheckpoint.practiceData, wordMap),
      }
    : null
  return {
    dictId: data.dictId,
    libraryVersion: data.libraryVersion,
    practiceType: data.practiceType,
    practiceMode: data.practiceMode,
    taskWords,
    practiceData,
    statStoreData: data.statStoreData,
    skipCheckpoint,
  }
}

export function usePracticeWordPersistence() {
  const dataSync = useDataSyncPersistence()
  let currentDictId: string | undefined

  function resolveDictId(dictId?: string, data?: PracticeWordCache | null): string | undefined {
    const resolved = dictId ?? data?.dictId ?? currentDictId ?? useBaseStore().sdict?.id
    if (resolved) currentDictId = String(resolved)
    return resolved ? String(resolved) : undefined
  }

  function latestTimestamp(...values: Array<string | undefined>): string {
    return (
      values.reduce<string | undefined>((latest, value) => {
        if (!value || Number.isNaN(Date.parse(value))) return latest
        if (!latest || Date.parse(value) > Date.parse(latest)) return value
        return latest
      }, undefined) ?? new Date().toISOString()
    )
  }

  async function migrateUnscopedLocalLegacyCache(dictId?: string): Promise<void> {
    if (!dictId) return
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const local = await getPracticeWordCacheLocalWithMeta()
        const payload = local?.val
        // This runs only during startup, while the persisted studyIndex still
        // identifies the old active book. A remote cache without dictId stays
        // unresolved because it cannot safely be attributed to any book.
        if (!payload || isPracticeWordCacheBundle(payload) || payload.dictId != null) return
        const bundle = mergePracticeWordCacheBundles(payload, null, local?.updated_at)
        if (!bundle?.unresolvedLegacy) return
        bundle.entries[dictId] = bundle.unresolvedLegacy
        delete bundle.unresolvedLegacy
        await setPracticeWordCacheBundleLocal(bundle, local?.updated_at)
      })
    await wordLocalWriteQueue
  }

  async function mergeWordBundleForRemotePush(
    snapshot: PracticeWordCacheBundle,
    updatedAt: string,
    remoteData: unknown,
    remoteUpdatedAt?: string
  ): Promise<PracticeWordCacheBundle | null> {
    let result: PracticeWordCacheBundle | null = null
    // Remote I/O happens before this callback. Queue the fresh local read and
    // IDB write with normal saves so a save that completed during that I/O is
    // always part of the merge and cannot be overwritten by an old snapshot.
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const local = await getPracticeWordCacheLocalWithMeta()
        const merged = mergePracticeWordCacheBundles(local?.val, snapshot, local?.updated_at, updatedAt)
        result = mergePracticeWordCacheBundles(
          merged,
          remoteData as PracticeWordCachePayload | undefined,
          updatedAt,
          remoteUpdatedAt
        )
        if (result) {
          await dataSync.saveLocalOnly(
            SyncDataType.practice_word,
            result,
            latestTimestamp(local?.updated_at, updatedAt, remoteUpdatedAt)
          )
        }
      })
    await wordLocalWriteQueue
    return result
  }

  async function mergeWordBundleFromRemotePull(
    remoteData: unknown,
    remoteUpdatedAt?: string
  ): Promise<PracticeWordCacheBundle | null> {
    let result: PracticeWordCacheBundle | null = null
    // Queue the read and write with ordinary saves. Without this, a visibility
    // pull can read an old local bundle and overwrite a just-completed save.
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const local = await getPracticeWordCacheLocalWithMeta()
        result = mergePracticeWordCacheBundles(
          local?.val,
          remoteData as PracticeWordCachePayload,
          local?.updated_at,
          remoteUpdatedAt
        )
        if (result) {
          await dataSync.saveLocalOnly(
            SyncDataType.practice_word,
            result,
            latestTimestamp(local?.updated_at, remoteUpdatedAt)
          )
        }
      })
    await wordLocalWriteQueue
    return result
  }

  async function loadLocal(dictId?: string): Promise<PracticeWordCache | null> {
    await wordLocalWriteQueue
    const resolvedDictId = resolveDictId(dictId)
    const bundle = await getPracticeWordCacheBundleLocal()
    return restorePracticeWordCache(getPracticeWordCacheFromPayload(bundle, resolvedDictId))
  }

  async function load(dictId?: string): Promise<PracticeWordCache | null> {
    await wordLocalWriteQueue
    const resolvedDictId = resolveDictId(dictId)
    const remote = await fetch(resolvedDictId)
    return remote ?? (await loadLocal(resolvedDictId))
  }

  async function fetch(dictId?: string): Promise<PracticeWordCache | null> {
    const resolvedDictId = resolveDictId(dictId)
    const remote = await dataSync.pullIfRemoteNewer(
      SyncDataType.practice_word,
      undefined,
      mergeWordBundleFromRemotePull
    )
    if (remote) {
      return restorePracticeWordCache(getPracticeWordCacheFromPayload(remote.data, resolvedDictId))
    }
    return null
  }

  /** Full per-dictionary payload for export and cloud backup. */
  async function getLocalDataCompact(): Promise<PracticeWordCacheBundle | null> {
    await wordLocalWriteQueue
    return await getPracticeWordCacheBundleLocal()
  }

  async function getLocalEntryCompact(dictId?: string): Promise<PracticeWordCacheStored | null> {
    await wordLocalWriteQueue
    const resolvedDictId = resolveDictId(dictId)
    const data = getPracticeWordCacheFromPayload(await getPracticeWordCacheBundleLocal(), resolvedDictId)
    const book = useBaseStore().word.bookList.find(book => String(book.id) === resolvedDictId)
    return book && isCompletedPracticeCache(book, data) ? null : data
  }

  async function save(data: PracticeWordCache | null, options?: { unifiedTiming?: boolean }) {
    const compactData = serializePracticeWordCache(data, options?.unifiedTiming === true)
    const dictId = resolveDictId(undefined, data)
    if (!dictId || !compactData) {
      console.warn('单词练习缓存缺少词典 ID，已跳过保存')
      return
    }
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const updatedAt = new Date().toISOString()
        const bundle = mergePracticeWordCacheBundles(await getPracticeWordCacheBundleLocal(), null) ?? {
          schemaVersion: 2 as const,
          entries: {},
        }
        bundle.entries[dictId] = { data: compactData, updatedAt }
        await dataSync.saveLocalOnly(SyncDataType.practice_word, bundle, updatedAt)
        scheduleWordRemoteSync({
          data: bundle,
          updatedAt,
          push: (snapshot, timestamp, keepalive) =>
            dataSync.pushSnapshotToRemote(
              SyncDataType.practice_word,
              snapshot,
              timestamp,
              undefined,
              keepalive,
              (remoteData, remoteUpdatedAt) =>
                mergeWordBundleForRemotePush(snapshot, timestamp, remoteData, remoteUpdatedAt)
            ),
        })
      })
    await wordLocalWriteQueue
  }

  async function clear(dictId?: string) {
    const resolvedDictId = resolveDictId(dictId)
    if (!resolvedDictId) {
      console.warn('单词练习缓存缺少词典 ID，已跳过清除')
      return
    }
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const updatedAt = new Date().toISOString()
        const bundle = mergePracticeWordCacheBundles(await getPracticeWordCacheBundleLocal(), null) ?? {
          schemaVersion: 2 as const,
          entries: {},
        }
        bundle.entries[resolvedDictId] = { data: null, updatedAt }
        await dataSync.saveLocalOnly(SyncDataType.practice_word, bundle, updatedAt)
        scheduleWordRemoteSync({
          data: bundle,
          updatedAt,
          push: (snapshot, timestamp, keepalive) =>
            dataSync.pushSnapshotToRemote(
              SyncDataType.practice_word,
              snapshot,
              timestamp,
              undefined,
              keepalive,
              (remoteData, remoteUpdatedAt) =>
                mergeWordBundleForRemotePush(snapshot, timestamp, remoteData, remoteUpdatedAt)
            ),
        })
      })
    await wordLocalWriteQueue
  }

  async function flushRemote(keepalive: boolean = false) {
    await wordLocalWriteQueue
    await waitForRunningWordSync()
    await flushWordRemoteSync(keepalive)
  }

  return {
    load,
    loadLocal,
    save,
    clear,
    flushRemote,
    fetch,
    getLocalDataCompact,
    getLocalEntryCompact,
    migrateUnscopedLocalLegacyCache,
  }
}

export function usePracticeArticlePersistence() {
  const dataSync = useDataSyncPersistence()

  async function load(): Promise<PracticeArticleCache | null> {
    const res = await fetch()
    return res ?? (await getPracticeArticleCacheLocal())
  }

  async function getLocalDataCompact(): Promise<PracticeArticleCache | null> {
    return await getPracticeArticleCacheLocal()
  }

  async function fetch(): Promise<PracticeArticleCache | null> {
    const remote = await dataSync.pullIfRemoteNewer(SyncDataType.practice_article)
    if (remote) {
      const remoteData = remote?.data as PracticeArticleCache
      return remoteData
    }
    return null
  }

  async function save(data: PracticeArticleCache | null): Promise<void> {
    await dataSync.saveLocalAndSync(SyncDataType.practice_article, data ?? null)
  }

  async function clear() {
    await dataSync.saveLocalAndSync(SyncDataType.practice_article, null, { pullWhenRemoteNewer: false })
  }

  return { load, save, clear, fetch, getLocalDataCompact }
}
