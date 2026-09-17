import type { BookTaskSettings } from '../types'
import type { PracticeWordCacheStored } from './cache'

export function sameBookTaskSettings(a: BookTaskSettings, b: BookTaskSettings): boolean {
  return a.newWordMode === b.newWordMode && a.perDayStudyNumber === b.perDayStudyNumber && a.reviewRatio === b.reviewRatio
}

/** Timer-only snapshots have no answers to discard; stage changes and first-word answers do. */
export function hasPracticeAnswerProgress(cache: PracticeWordCacheStored | null, initialStage?: number): boolean {
  if (!cache?.practiceData) return false
  const data = cache.practiceData
  const stat = cache.statStoreData
  const wrongWords = 'wrongWordsStr' in data ? data.wrongWordsStr : data.wrongWords
  return !!(
    data.index > 0 || data.wrongTimes > 0 || data.isTypingWrongWord ||
    wrongWords?.length || data.excludeWords?.length || data.allWrongWords?.length || data.duplicateSkippedWords?.length ||
    Object.keys(data.ratingMap ?? {}).length || Object.keys(data.wrongTimesMap ?? {}).length ||
    (stat?.inputWordNumber ?? 0) > 0 || (stat?.skippedWordNumber ?? 0) > 0 || (stat?.wrong ?? 0) > 0 ||
    cache.skipCheckpoint ||
    (initialStage !== undefined && stat?.stage !== undefined && stat.stage !== initialStage)
  )
}

export function getCachedTaskWords(cache: PracticeWordCacheStored | null) {
  if (!cache) return null
  return 'taskWordsStr' in cache ? cache.taskWordsStr : cache.taskWords
}

export function shouldRebuildPracticeForSettings(
  current: BookTaskSettings,
  proposed: BookTaskSettings,
  cache: PracticeWordCacheStored | null,
  duplicateChanged: boolean,
  expectedLegacyNewCount?: number
): boolean {
  if (!sameBookTaskSettings(current, proposed)) return true
  // A duplicate-policy edit applies to subsequent answers without discarding a round.
  if (duplicateChanged) return false
  const task = getCachedTaskWords(cache)
  if (!task) return false
  if (task.settings) return !sameBookTaskSettings(task.settings, proposed)
  return proposed.newWordMode === 'unit' && !task.unitReview && task.new.length > 0 &&
    expectedLegacyNewCount !== undefined && task.new.length < expectedLegacyNewCount
}
