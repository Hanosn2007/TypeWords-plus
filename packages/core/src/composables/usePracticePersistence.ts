import { useBaseStore } from '../stores'
import type { PracticeState } from '../stores/practice'
import { PracticeData, SyncDataType, TaskWords, Word } from '../types'
import type {
  PracticeArticleCache,
  PracticeWordCache,
  PracticeWordCacheCompact,
  PracticeWordCacheStored,
} from '../utils/cache'
import { getPracticeArticleCacheLocal, getPracticeWordCacheLocal } from '../utils/cache'
import { useDataSyncPersistence } from './useDataSyncPersistence'
import dayjs from 'dayjs'

type DayGroup = { firstStart: number; totalSpend: number; daySegments: [number, number][] }
type PendingWordSync = {
  data: PracticeWordCacheStored | null
  updatedAt: string
  push: (data: PracticeWordCacheStored | null, updatedAt: string) => Promise<boolean>
}

let pendingWordSync: PendingWordSync | null = null
let wordSyncTimer: ReturnType<typeof setTimeout> | null = null
let wordSyncRunning = false
let wordLocalWriteQueue: Promise<void> = Promise.resolve()

function scheduleWordRemoteSync(sync: PendingWordSync) {
  pendingWordSync = sync
  if (wordSyncTimer) clearTimeout(wordSyncTimer)
  wordSyncTimer = setTimeout(flushWordRemoteSync, 800)
}

async function flushWordRemoteSync() {
  if (wordSyncRunning || !pendingWordSync) return
  const current = pendingWordSync
  pendingWordSync = null
  wordSyncRunning = true
  try {
    const success = await current.push(current.data, current.updatedAt)
    if (!success && !pendingWordSync) {
      pendingWordSync = current
    }
  } finally {
    wordSyncRunning = false
    if (pendingWordSync) {
      if (wordSyncTimer) clearTimeout(wordSyncTimer)
      wordSyncTimer = setTimeout(flushWordRemoteSync, pendingWordSync === current ? 10_000 : 0)
    }
  }
}

/**
 * 将进行中的练习统计（PracticeState）落库到 store.sdict.statistics。
 * 用于切换词典或修改练习设置前调用，避免学习记录丢失。
 * @param st - 来自缓存或内存的 PracticeState，为 null / spend=0 时直接返回
 */
export function flushStatToStore(st: PracticeState | null | undefined): void {
  const hasSegmentSpend = Array.isArray(st?.segments) && st.segments.some(([start, end]) => Number(end) > Number(start))
  if (!st || (!st.spend && !hasSegmentSpend)) return
  const store = useBaseStore()

  const baseInfo = {
    total: st.total,
    wrong: st.wrong,
    new: st.newWordNumber,
    review: st.reviewWordNumber,
  }

  if (Array.isArray(st.segments) && st.segments.length > 0) {
    const dayMap = new Map<string, DayGroup>()
    for (const [segStart, segEnd] of st.segments) {
      const dayKey = dayjs(segStart).format('YYYY-MM-DD')
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, { firstStart: segStart, totalSpend: 0, daySegments: [] })
      }
      const group = dayMap.get(dayKey)!
      group.totalSpend += segEnd - segStart
      group.daySegments.push([segStart, segEnd])
    }
    const dayKeys = Array.from(dayMap.keys())
    if (dayKeys.length === 1) {
      store.sdict.statistics.push({
        ...baseInfo,
        spend: dayMap.get(dayKeys[0])!.totalSpend,
        startDate: dayMap.get(dayKeys[0])!.firstStart,
        segments: dayMap.get(dayKeys[0])!.daySegments,
        sessionRole: 'single',
      })
    } else {
      dayKeys.forEach((dayKey, idx) => {
        const group = dayMap.get(dayKey)!
        const sessionRole = idx === 0 ? 'start' : idx === dayKeys.length - 1 ? 'end' : 'middle'
        store.sdict.statistics.push({
          ...baseInfo,
          spend: group.totalSpend,
          startDate: group.firstStart,
          segments: group.daySegments,
          sessionRole: sessionRole as 'start' | 'middle' | 'end',
        })
      })
    }
  } else {
    store.sdict.statistics.push({
      ...baseInfo,
      spend: st.spend,
      startDate: st.startDate,
      sessionRole: 'single',
    })
  }
}

function isCompactPracticeWordCache(data: PracticeWordCacheStored | null): data is PracticeWordCacheCompact {
  return !!data && 'taskWordsStr' in data
}

function createWordMap(): Map<string, Word> {
  const store = useBaseStore()
  return new Map(store.sdict.words.map(word => [word.word, word]))
}

function restoreWords(words: string[], wordMap: Map<string, Word>): Word[] {
  return words.map(word => wordMap.get(word)).filter((word): word is Word => !!word)
}

function serializePracticeWordCache(data: PracticeWordCache | null): PracticeWordCacheStored | null {
  if (!data) return null
  const { words, wrongWords, ...practiceDataRest } = data.practiceData
  return {
    dictId: data.dictId,
    practiceType: data.practiceType,
    taskWordsStr: {
      new: data.taskWords.new.map(v => v.word),
      review: data.taskWords.review.map(v => v.word),
    },
    practiceData: {
      ...practiceDataRest,
      wordsStr: words.map(v => v.word),
      wrongWordsStr: wrongWords.map(v => v.word),
    },
    statStoreData: data.statStoreData,
  }
}

function restorePracticeWordCache(data: PracticeWordCacheStored | null): PracticeWordCache | null {
  if (!data) return null
  if (!isCompactPracticeWordCache(data)) {
    if (!data.taskWords?.new.length && !data.taskWords?.review.length) return null
    return data
  }
  if (!data.taskWordsStr?.new.length && !data.taskWordsStr?.review.length) return null
  const wordMap = createWordMap()
  const taskWords: TaskWords = {
    new: restoreWords(data.taskWordsStr.new, wordMap),
    review: restoreWords(data.taskWordsStr.review, wordMap),
  }

  const words = restoreWords(data.practiceData?.wordsStr ?? [], wordMap)
  const wrongWords = restoreWords(data.practiceData?.wrongWordsStr ?? [], wordMap)
  const index = words.length ? Math.min(data.practiceData.index, words.length - 1) : 0

  const practiceData: PracticeData = {
    ...data.practiceData,
    index,
    words,
    wrongWords,
  }
  return {
    dictId: data.dictId,
    practiceType: data.practiceType,
    taskWords,
    practiceData,
    statStoreData: data.statStoreData,
  }
}

export function usePracticeWordPersistence() {
  const dataSync = useDataSyncPersistence()

  async function loadLocal(): Promise<PracticeWordCache | null> {
    await wordLocalWriteQueue
    return restorePracticeWordCache(await getPracticeWordCacheLocal())
  }

  async function load(): Promise<PracticeWordCache | null> {
    const remote = await fetch()
    return remote ?? (await loadLocal())
  }

  async function fetch(): Promise<PracticeWordCache | null> {
    const remote = await dataSync.pullIfRemoteNewer(SyncDataType.practice_word)
    if (remote) {
      const remoteData = remote?.data as PracticeWordCacheStored
      return restorePracticeWordCache(remoteData)
    }
    return null
  }

  async function getLocalDataCompact(): Promise<PracticeWordCacheStored> {
    return await getPracticeWordCacheLocal()
  }

  async function save(data: PracticeWordCache | null) {
    const compactData = serializePracticeWordCache(data)
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const updatedAt = await dataSync.saveLocalOnly(SyncDataType.practice_word, compactData)
        scheduleWordRemoteSync({
          data: compactData,
          updatedAt,
          push: (snapshot, timestamp) => dataSync.pushSnapshotToRemote(SyncDataType.practice_word, snapshot, timestamp),
        })
      })
    await wordLocalWriteQueue
  }

  async function clear() {
    wordLocalWriteQueue = wordLocalWriteQueue
      .catch(error => console.warn('上一次单词练习本地保存失败', error))
      .then(async () => {
        const updatedAt = await dataSync.saveLocalOnly(SyncDataType.practice_word, null)
        scheduleWordRemoteSync({
          data: null,
          updatedAt,
          push: (snapshot, timestamp) => dataSync.pushSnapshotToRemote(SyncDataType.practice_word, snapshot, timestamp),
        })
      })
    await wordLocalWriteQueue
  }

  return { load, loadLocal, save, clear, fetch, getLocalDataCompact }
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
