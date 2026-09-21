import dayjs from 'dayjs'
import type { Dict, TaskWords } from '../types'
import { getBookTaskSettings, getNewWordLimit, normalizeBookLearning, normalizeLearningWord, selectUnitTaskWords, scanStudyWords } from '../utils/bookLearning.ts'

export type StudyTaskInput = {
  book: Dict
  ignoredWords: ReadonlySet<string>
  defaultReviewRatio: number
  now: number
  random: () => number
  /** Compatibility cursor captured before legacy unit progress preparation. */
  startIndex?: number
}

export type StudyTaskPlan = {
  task: TaskWords
  /** Existing cleanup policy; the caller decides when to commit it. */
  ignoredCardKeys: string[]
}

/** No store, persistence, clock or UI access. Does not mutate the input book. */
export function planStudyTask(input: StudyTaskInput): StudyTaskPlan {
  const { ignoredWords, defaultReviewRatio, now, random } = input
  // Existing unit selectors expect a normalized learning object. Give them an
  // owned view so their lazy normalization cannot write into the caller's book.
  const book = { ...input.book, learning: normalizeBookLearning(input.book.learning) }
  const words = book.words
  const start = input.startIndex ?? Math.min(Math.max(Number(book.lastLearnIndex) || 0, 0), words.length)
  const task: TaskWords = { new: [], review: [], startIndex: start, endIndex: start }
  if (book.library) task.libraryVersion = book.library.version
  const ignoredCardKeys: string[] = []
  if (!words.length) return { task, ignoredCardKeys }
  const learning = book.learning
  const ignored = new Set([...ignoredWords, ...learning.skippedWords.map(normalizeLearningWord)])
  task.settings = getBookTaskSettings(book, defaultReviewRatio)
  const perRound = book.perDayStudyNumber
  const atEnd = start >= words.length
  const complete = book.complete || atEnd
  const ratio = learning.reviewRatio ?? defaultReviewRatio
  if (book.units?.length) {
    const selected = selectUnitTaskWords(book, getNewWordLimit(book), ignored)
    task.new = selected.new
    task.unitId = learning.selectedUnitId ?? ''
    task.unitScannedWords = selected.scanned
  } else if (!atEnd) {
    const selected = scanStudyWords(words.slice(start), ignored, perRound)
    task.new = selected.new
    task.unitScannedWords = selected.scanned
    task.endIndex = start + selected.visited
  }
  task.unitId ??= ''
  if (ratio >= 1 || complete || atEnd) {
    const wordMap = new Map(words.map(word => [normalizeLearningWord(word.word), word]))
    const newKeys = new Set(task.new.map(word => normalizeLearningWord(word.word)))
    const total = perRound * (atEnd ? ratio || 1 : ratio)
    const cards = Object.entries(learning.fsrs)
    const due = cards.filter(([word, card]) => {
      const key = normalizeLearningWord(word)
      if (ignored.has(key)) ignoredCardKeys.push(key)
      return !ignored.has(key) && dayjs(card.due).valueOf() <= now && wordMap.has(key) && !newKeys.has(key)
    }).sort((a, b) => dayjs(a[1].due).valueOf() - dayjs(b[1].due).valueOf())
    task.review = due.slice(0, total).flatMap(([key]) => {
      const word = wordMap.get(normalizeLearningWord(key))
      return word ? [word] : []
    })
    for (let i = task.review.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[task.review[i], task.review[j]] = [task.review[j], task.review[i]]
    }
    if (task.review.length < total) {
      const learned = new Set(learning.learnedWords)
      let candidates = book.units?.length
        ? words.filter(word => learned.has(normalizeLearningWord(word.word))).reverse()
        : words.slice(0, start).reverse()
      if (complete && !book.units?.length) candidates = candidates.concat(words.slice(task.endIndex).reverse())
      const excluded = new Set([...ignored, ...Object.keys(learning.fsrs), ...newKeys])
      candidates = candidates.filter(word => !excluded.has(normalizeLearningWord(word.word)))
      task.review.push(...candidates.slice(0, total - task.review.length))
    }
  }
  return { task, ignoredCardKeys }
}
