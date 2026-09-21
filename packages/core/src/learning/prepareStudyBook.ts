import type { Card } from 'ts-fsrs'
import type { Dict } from '../types'
import { getBookLearning, migrateLegacyFsrsToBookLearning, normalizeLearningWord, refreshUnitBookProgress } from '../utils/bookLearning.ts'

/** Explicit compatibility write command. Keep out of preview/read-only planning. */
export function prepareStudyBook(book: Dict, legacyCards: Record<string, Card>, ignoredWords: ReadonlySet<string>): void {
  if (!book.words.length) return
  const learning = getBookLearning(book)
  migrateLegacyFsrsToBookLearning(book, legacyCards)
  if (book.units?.length) {
    refreshUnitBookProgress(book, new Set([...ignoredWords, ...learning.skippedWords.map(normalizeLearningWord)]))
  }
}

/** Preserve the existing ignored-card cleanup policy without hiding a write in a selector. */
export function applyStudyCardCleanup(book: Dict, keys: readonly string[]): void {
  if (!keys.length) return
  const cards = getBookLearning(book).fsrs
  for (const key of keys) delete cards[key]
}
