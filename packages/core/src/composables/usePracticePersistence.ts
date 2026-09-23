import { useBaseStore } from '../stores'
import { Toast } from '@typewords/base'
import { getBookLearning, isCompletedPracticeCache, normalizeLearningWord } from '../utils/bookLearning'
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
  upgradePracticeScopes,
  practiceScopeKey,
  cacheScopeKey,
} from '../utils/cache'
import { useDataSyncPersistence } from './useDataSyncPersistence'
import { getPracticeTimeDays, stripPracticeTimeAccounting } from '../utils/practiceTime'
import { loadLibraryBook } from '../utils/libraryBooks'
import { registerSaveBarrier, scheduleSafeSync } from '../utils/safeSync'

let wordLocalWriteQueue: Promise<void> = Promise.resolve()
registerSaveBarrier(() => wordLocalWriteQueue)

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
  const compact = {
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
  // Freeze the small checkpoint before queuing the asynchronous write. Cloning
  // before compaction needlessly traverses every definition/example in a round.
  return JSON.parse(JSON.stringify(compact)) as PracticeWordCacheStored
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
  if (
    taskWords.new.length !== data.taskWordsStr.new.length ||
    taskWords.review.length !== data.taskWordsStr.review.length ||
    practiceData.words.length !== data.practiceData.wordsStr.length
  ) {
    throw new Error('本轮词书内容不完整，原练习已保留。请联网加载对应版本后重试，或在词书设置中明确重新开始。')
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

export function usePracticeWordPersistence(options?: { free?: () => boolean }) {
  const dataSync = useDataSyncPersistence()
  let currentDictId: string | undefined
  function scope(dictId?: string) {
    const book = useBaseStore().word.bookList.find(book => String(book.id) === dictId)
    return { unitId: book?.learning?.selectedUnitId ?? '', free: options?.free?.() ?? false }
  }
  function scopedCache(payload: PracticeWordCachePayload | undefined, dictId?: string) {
    const { unitId, free } = scope(dictId)
    return getPracticeWordCacheFromPayload(payload, dictId, unitId, free)
  }

  function resolveDictId(dictId?: string, data?: PracticeWordCache | null): string | undefined {
    const resolved = dictId ?? data?.dictId ?? currentDictId ?? useBaseStore().sdict?.id
    if (resolved) currentDictId = String(resolved)
    return resolved ? String(resolved) : undefined
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


  async function loadLocal(dictId?: string): Promise<PracticeWordCache | null> {
    await wordLocalWriteQueue
    const resolvedDictId = resolveDictId(dictId)
    const bundle = await getPracticeWordCacheBundleLocal()
    return restorePracticeWordCache(scopedCache(bundle, resolvedDictId))
  }

  async function load(dictId?: string): Promise<PracticeWordCache | null> {
    await wordLocalWriteQueue
    const resolvedDictId = resolveDictId(dictId)
    const remote = await fetch(resolvedDictId)
    return remote ?? (await loadLocal(resolvedDictId))
  }

  async function fetch(dictId?: string): Promise<PracticeWordCache | null> {
    // Whole-snapshot synchronization is coordinated separately.
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
    const data = scopedCache(await getPracticeWordCacheBundleLocal(), resolvedDictId)
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
        const bundle = upgradePracticeScopes(await getPracticeWordCacheBundleLocal())
        bundle.entries[cacheScopeKey(compactData, dictId)] = { data: compactData, updatedAt }
        await dataSync.saveLocalOnly(SyncDataType.practice_word, bundle, updatedAt)
        scheduleSafeSync()
      })
    await wordLocalWriteQueue
  }

  async function clear(dictId?: string) {
    const resolvedDictId = resolveDictId(dictId)
    if (!resolvedDictId) {
      console.warn('单词练习缓存缺少词典 ID，已跳过清除')
      return
    }
    const { unitId, free } = scope(resolvedDictId)
    const clearingKey = practiceScopeKey(resolvedDictId, unitId, free)
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const updatedAt = new Date().toISOString()
        const bundle = upgradePracticeScopes(await getPracticeWordCacheBundleLocal())
        bundle.entries[clearingKey] = { data: null, updatedAt }
        await dataSync.saveLocalOnly(SyncDataType.practice_word, bundle, updatedAt)
        scheduleSafeSync()
      })
    await wordLocalWriteQueue
  }

  async function flushRemote(keepalive: boolean = false) {
    await wordLocalWriteQueue
    scheduleSafeSync()
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
