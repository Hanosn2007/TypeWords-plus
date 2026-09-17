import type { Dict, Statistics } from '../types/types.ts'
import type { PracticeWordCacheBundle } from './cache.ts'
import { getPracticeTimeDays } from './practiceTime.ts'
import { isCompletedPracticeCache } from './bookLearning.ts'

export type StudyStatisticsRow = Statistics & { dictId: string; dictName: string; pending?: boolean }

/** Only identified, live tasks belonging to a current book contribute to global totals. */
export function collectStudyStatistics(
  books: Pick<Dict, 'id' | 'name' | 'statistics' | 'learning'>[],
  bundle: PracticeWordCacheBundle | null | undefined,
  completeStage: number
): StudyStatisticsRow[] {
  const rows: StudyStatisticsRow[] = []
  const seen = new Set<string>()
  for (const book of books) {
    const dictId = String(book.id)
    if (!book.id || seen.has(dictId)) continue
    seen.add(dictId)
    for (const stat of book.statistics ?? []) {
      rows.push({ ...stat, dictId, dictName: book.name })
    }
    const cache = bundle?.entries?.[dictId]?.data
    if (!cache || (cache.dictId != null && String(cache.dictId) !== dictId)) continue
    if (isCompletedPracticeCache(book, cache)) continue
    const st = cache.statStoreData
    if (!st || st.stage === completeStage) continue
    const days = getPracticeTimeDays(st)
    days.forEach((day, index) => rows.push({
      dictId, dictName: book.name, pending: true,
      startDate: day.startDate, spend: day.spend, segments: day.segments,
      total: st.total, new: st.newWordNumber, review: st.reviewWordNumber,
      wrong: st.wrong, skipped: st.skippedWordNumber ?? 0,
      sessionRole: days.length === 1 ? 'single' : index === 0 ? 'start' : 'middle',
    }))
  }
  return rows
}
