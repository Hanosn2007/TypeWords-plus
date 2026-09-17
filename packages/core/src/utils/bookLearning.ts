import type { Card } from 'ts-fsrs'
import type { BookLearning, BookTaskSettings, BookUnit, Dict, DuplicateMode, NewWordMode, TaskWords, Word } from '../types'

export type OtherBookLearningSource = {
  id: string | number
  name: string
  mastered: boolean
}

/** Use one canonical key for persisted learning data and all word comparisons. */
export function normalizeLearningWord(word: string | null | undefined): string {
  return String(word ?? '')
    .trim()
    .toLocaleLowerCase()
}

function normalizeWordList(words: unknown): string[] {
  if (!Array.isArray(words)) return []
  return Array.from(new Set(words.map(word => normalizeLearningWord(String(word))).filter(Boolean)))
}

function normalizeUnitId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return id || undefined
}

function normalizeSelectedUnitId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim()
}

/**
 * Normalizes unit metadata stored with a dictionary. Unit identifiers remain
 * case-sensitive, while member words use the same canonical key as learning
 * progress. A word can belong to several units while sharing its book-level card.
 */
export function normalizeBookUnits(value: unknown): BookUnit[] {
  if (!Array.isArray(value)) return []

  const unitIds = new Set<string>()
  const result: BookUnit[] = []

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const unit = candidate as Partial<BookUnit>
    const id = normalizeUnitId(unit.id)
    const name = typeof unit.name === 'string' ? unit.name.trim() : ''
    if (!id || !name || unitIds.has(id)) continue

    const words: string[] = []
    const assignedWords = new Set<string>()
    if (Array.isArray(unit.words)) {
      for (const word of unit.words) {
        if (typeof word !== 'string') continue
        const key = normalizeLearningWord(word)
        if (!key || assignedWords.has(key)) continue
        assignedWords.add(key)
        words.push(key)
      }
    }

    unitIds.add(id)
    result.push({ id, name, words })
  }

  return result
}

function normalizeFsrs(fsrs: unknown): Record<string, Card> {
  if (!fsrs || typeof fsrs !== 'object' || Array.isArray(fsrs)) return {}
  const result: Record<string, Card> = {}
  Object.entries(fsrs as Record<string, Card>).forEach(([word, card]) => {
    const key = normalizeLearningWord(word)
    if (key && card && typeof card === 'object') result[key] = card
  })
  return result
}

function normalizeDuplicateMode(mode: unknown): DuplicateMode {
  return mode === 'off' || mode === 'auto' || mode === 'manual' ? mode : 'manual'
}

function normalizeNewWordMode(mode: unknown): NewWordMode | undefined {
  return mode === 'unit' || mode === 'custom' ? mode : undefined
}

function normalizeReviewRatio(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function normalizePracticeMode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6 ? value : undefined
}

export function getDefaultBookLearning(): BookLearning {
  return {
    version: 1,
    fsrs: {},
    learnedWords: [],
    masteredWords: [],
    skippedWords: [],
    duplicateMode: 'manual',
  }
}

/** Normalize a deserialized learning payload before it enters reactive state. */
export function normalizeBookLearning(value: unknown): BookLearning {
  const stored = value as Partial<BookLearning> | undefined
  const reviewRatio = normalizeReviewRatio(stored?.reviewRatio)
  const practiceMode = normalizePracticeMode(stored?.practiceMode)
  const selectedUnitId = normalizeSelectedUnitId(stored?.selectedUnitId)
  const newWordMode = normalizeNewWordMode(stored?.newWordMode)
  return {
    version: 1,
    fsrs: normalizeFsrs(stored?.fsrs),
    learnedWords: normalizeWordList(stored?.learnedWords),
    masteredWords: normalizeWordList(stored?.masteredWords),
    skippedWords: normalizeWordList(stored?.skippedWords),
    duplicateMode: normalizeDuplicateMode(stored?.duplicateMode),
    ...(reviewRatio !== undefined ? { reviewRatio } : {}),
    ...(practiceMode !== undefined ? { practiceMode: practiceMode as BookLearning['practiceMode'] } : {}),
    ...(selectedUnitId !== undefined ? { selectedUnitId } : {}),
    ...(newWordMode !== undefined ? { newWordMode } : {}),
    ...(typeof stored?.lastCompletedPracticeAt === 'number' && Number.isFinite(stored.lastCompletedPracticeAt)
      ? { lastCompletedPracticeAt: stored.lastCompletedPracticeAt } : {}),
    ...(Array.isArray(stored?.unitProcessedWords) ? { unitProcessedWords: normalizeWordList(stored.unitProcessedWords) } : {}),
    ...(stored?.legacyFsrsMigrated ? { legacyFsrsMigrated: true } : {}),
  }
}

function isCanonicalBookLearning(value: unknown): value is BookLearning {
  if (!value || typeof value !== 'object') return false
  const learning = value as BookLearning
  return (
    learning.version === 1 &&
    !!learning.fsrs &&
    typeof learning.fsrs === 'object' &&
    Array.isArray(learning.learnedWords) &&
    Array.isArray(learning.masteredWords) &&
    Array.isArray(learning.skippedWords) &&
    (learning.duplicateMode === 'off' || learning.duplicateMode === 'manual' || learning.duplicateMode === 'auto') &&
    (learning.newWordMode === undefined || learning.newWordMode === 'unit' || learning.newWordMode === 'custom') &&
    (learning.lastCompletedPracticeAt === undefined || (typeof learning.lastCompletedPracticeAt === 'number' && Number.isFinite(learning.lastCompletedPracticeAt))) &&
    (learning.reviewRatio === undefined || (Number.isFinite(learning.reviewRatio) && learning.reviewRatio >= 0)) &&
    (learning.practiceMode === undefined || (Number.isInteger(learning.practiceMode) && learning.practiceMode >= 0 && learning.practiceMode <= 6)) &&
    (learning.selectedUnitId === undefined ||
      (typeof learning.selectedUnitId === 'string' && learning.selectedUnitId === learning.selectedUnitId.trim())) &&
    (learning.unitProcessedWords === undefined || Array.isArray(learning.unitProcessedWords))
  )
}

/**
 * Returns the mutable learning record for a book, upgrading incomplete persisted
 * values in place so it is also retained by normal dict serialization.
 */
export function getBookLearning(dict: Dict): BookLearning {
  if (!dict.learning) {
    dict.learning = getDefaultBookLearning()
    return dict.learning
  }
  // Most calls happen from Pinia getters and templates. Do not replace a valid
  // reactive object there, or every read becomes another reactive write.
  if (isCanonicalBookLearning(dict.learning)) return dict.learning
  dict.learning = normalizeBookLearning(dict.learning)
  return dict.learning
}

/** The round marker is saved with statistics and progress, before removing its cache. */
export function isCompletedPracticeCache(
  dict: Pick<Dict, 'id' | 'learning'>,
  cache: { dictId?: string; statStoreData?: { startDate?: number } } | null | undefined
): boolean {
  if (!cache || (cache.dictId != null && String(cache.dictId) !== String(dict.id))) return false
  const completedAt = dict.learning?.lastCompletedPracticeAt
  return typeof completedAt === 'number' && Number.isFinite(completedAt) && completedAt === cache.statStoreData?.startDate
}

/**
 * Lists other books that have recorded this word. `mastered` distinguishes an
 * explicit mastery decision from merely having learned it before.
 */
export function findOtherBookLearning(
  books: Dict[],
  currentDict: Dict,
  word: string
): OtherBookLearningSource[] {
  const key = normalizeLearningWord(word)
  if (!key) return []
  return books
    .filter(book => book !== currentDict && String(book.id) !== String(currentDict.id))
    .flatMap(book => {
      const learning = book.learning
      if (!isCanonicalBookLearning(learning)) return []
      const mastered = learning.masteredWords.includes(key)
      if (!mastered && !learning.learnedWords.includes(key)) return []
      return [{ id: book.id, name: book.name, mastered }]
    })
}

/**
 * Migrates only cards whose word is already inside this loaded book's completed
 * range. The old global map is deliberately never changed or deleted.
 */
export function migrateLegacyFsrsToBookLearning(dict: Dict, legacyFsrs: Record<string, Card>): boolean {
  const learning = getBookLearning(dict)
  if (learning.legacyFsrsMigrated || !Array.isArray(dict.words) || !dict.words.length) return false

  const learnedEnd = Math.min(Math.max(Number(dict.lastLearnIndex) || 0, 0), dict.words.length)
  if (!learnedEnd) return false

  const historicalWords = new Set(dict.words.slice(0, learnedEnd).map(word => normalizeLearningWord(word.word)).filter(Boolean))
  const masteredWords = new Set(learning.masteredWords)
  const skippedWords = new Set(learning.skippedWords)
  learning.learnedWords = Array.from(
    new Set([...learning.learnedWords, ...Array.from(historicalWords).filter(word => !masteredWords.has(word) && !skippedWords.has(word))])
  )
  Object.entries(legacyFsrs ?? {}).forEach(([word, card]) => {
    const key = normalizeLearningWord(word)
    if (key && historicalWords.has(key) && card && typeof card === 'object' && !learning.fsrs[key]) {
      learning.fsrs[key] = { ...card }
    }
  })
  learning.legacyFsrsMigrated = true
  return true
}

/** Adds legacy global "known" words only to the selected loaded book. */
export function migrateLegacyMasteryToBookLearning(dict: Dict, legacyMasteredWords: string[]): boolean {
  if (!Array.isArray(dict.words) || !dict.words.length) return false
  const learning = getBookLearning(dict)
  const wordsInBook = new Set(dict.words.map(word => normalizeLearningWord(word.word)).filter(Boolean))
  const additions = normalizeWordList(legacyMasteredWords).filter(word => wordsInBook.has(word))
  if (!additions.length) return true
  learning.masteredWords = Array.from(new Set([...learning.masteredWords, ...additions]))
  return true
}

function getActualWordMap(dict: Dict): Map<string, Word> {
  const words = new Map<string, Word>()
  for (const word of Array.isArray(dict.words) ? dict.words : []) {
    const key = normalizeLearningWord(word?.word)
    if (key && !words.has(key)) words.set(key, word)
  }
  return words
}

function hasBookUnits(dict: Dict): boolean {
  return normalizeBookUnits(dict.units).length > 0
}

/**
 * Gets words in unit order. The empty unit id represents the whole book: all
 * assigned words first, followed by dictionary words that have no unit.
 */
export function getUnitWords(dict: Dict, unitId: string = ''): Word[] {
  const units = normalizeBookUnits(dict.units)
  if (!units.length) return Array.isArray(dict.words) ? dict.words : []

  const actualWords = getActualWordMap(dict)
  const normalizedUnitId = normalizeSelectedUnitId(unitId) ?? ''
  if (normalizedUnitId) {
    const unit = units.find(item => item.id === normalizedUnitId)
    if (!unit) return []
    return unit.words.flatMap(word => {
      const actual = actualWords.get(word)
      return actual ? [actual] : []
    })
  }

  const result: Word[] = []
  const assignedWords = new Set<string>()
  for (const unit of units) {
    for (const key of unit.words) {
      if (assignedWords.has(key)) continue
      assignedWords.add(key)
      const actual = actualWords.get(key)
      if (actual) result.push(actual)
    }
  }
  for (const [key, word] of actualWords) {
    if (!assignedWords.has(key)) result.push(word)
  }
  return result
}

/** Whole-book selection always keeps its numeric limit, even in follow-unit mode. */
export function isFollowingStudyUnit(dict: Dict): boolean {
  const learning = getBookLearning(dict)
  return learning.newWordMode !== 'custom' && !!learning.selectedUnitId &&
    !!dict.units?.some(unit => unit.id === learning.selectedUnitId)
}

/** The task selector excludes handled words; the full unit size lets it visit every member. */
export function getNewWordLimit(dict: Dict): number {
  return isFollowingStudyUnit(dict)
    ? getUnitWords(dict, getBookLearning(dict).selectedUnitId).length
    : dict.perDayStudyNumber
}

export function getBookTaskSettings(dict: Dict, defaultReviewRatio: number): BookTaskSettings {
  return {
    newWordMode: isFollowingStudyUnit(dict) ? 'unit' : 'custom',
    perDayStudyNumber: dict.perDayStudyNumber,
    reviewRatio: getBookLearning(dict).reviewRatio ?? defaultReviewRatio,
  }
}

function addNormalizedWords(target: Set<string>, words: Iterable<string> | undefined): void {
  if (!words) return
  for (const word of words) {
    const key = normalizeLearningWord(word)
    if (key) target.add(key)
  }
}

/** Returns all explicitly handled words; cursor position never implies handling. */
export function getBookHandledWordSet(dict: Dict, ignored?: ReadonlySet<string>): Set<string> {
  const learning = getBookLearning(dict)
  const handled = new Set<string>()
  addNormalizedWords(handled, learning.learnedWords)
  addNormalizedWords(handled, learning.masteredWords)
  addNormalizedWords(handled, learning.skippedWords)
  addNormalizedWords(handled, learning.unitProcessedWords)
  addNormalizedWords(handled, ignored)
  return handled
}

export type UnitProgress = {
  total: number
  handled: number
  learned: number
  skipped: number
  remaining: number
}

/** Measures progress from real current words, so deleted or later-added words stay accurate. */
export function getUnitProgress(dict: Dict, unitId: string = '', ignored?: ReadonlySet<string>): UnitProgress {
  const learning = getBookLearning(dict)
  const handledWords = getBookHandledWordSet(dict, ignored)
  const learnedWords = new Set<string>()
  const skippedWords = new Set<string>()
  addNormalizedWords(learnedWords, learning.learnedWords)
  addNormalizedWords(skippedWords, learning.skippedWords)

  let total = 0
  let handled = 0
  let learned = 0
  let skipped = 0
  const seen = new Set<string>()
  for (const word of getUnitWords(dict, unitId)) {
    const key = normalizeLearningWord(word?.word)
    if (!key || seen.has(key)) continue
    seen.add(key)
    total++
    if (handledWords.has(key)) handled++
    if (learnedWords.has(key)) learned++
    if (skippedWords.has(key)) skipped++
  }
  return { total, handled, learned, skipped, remaining: total - handled }
}

/** Selects unhandled new words from the configured unit without crossing into another unit. */
export function selectUnitNewWords(dict: Dict, limit: number, ignored?: ReadonlySet<string>): Word[] {
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (!max) return []

  const selectedUnitId = getBookLearning(dict).selectedUnitId ?? ''
  const handledWords = getBookHandledWordSet(dict, ignored)
  const selected: Word[] = []
  const seen = new Set<string>()
  for (const word of getUnitWords(dict, selectedUnitId)) {
    const key = normalizeLearningWord(word?.word)
    if (!key || seen.has(key) || handledWords.has(key)) continue
    seen.add(key)
    selected.push(word)
    if (selected.length >= max) break
  }
  return selected
}

export type UnitTaskWords = {
  new: Word[]
  scanned: string[]
}

/**
 * Plans a unit task without mutating progress. Words already handled by the
 * book or an active ignore setting are still recorded as scanned, but only the
 * portion visited before the requested number of new words is returned.
 */
export function selectUnitTaskWords(dict: Dict, limit: number, ignored?: ReadonlySet<string>): UnitTaskWords {
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (!max) return { new: [], scanned: [] }

  const selectedUnitId = getBookLearning(dict).selectedUnitId ?? ''
  const handledWords = getBookHandledWordSet(dict, ignored)
  const fresh: Word[] = []
  const scanned: string[] = []
  const seen = new Set<string>()
  for (const word of getUnitWords(dict, selectedUnitId)) {
    const key = normalizeLearningWord(word?.word)
    if (!key || seen.has(key)) continue
    seen.add(key)
    scanned.push(key)
    if (!handledWords.has(key)) fresh.push(word)
    if (fresh.length >= max) break
  }
  return { new: fresh, scanned }
}

/**
 * Recomputes legacy cursor fields for unit books from actual handled words.
 * The cursor remains tied to dictionary order, so completing a later unit
 * cannot make an earlier unfinished word appear complete.
 */
export function refreshUnitBookProgress(dict: Dict, ignored?: ReadonlySet<string>): void {
  if (!hasBookUnits(dict)) return

  const handledWords = getBookHandledWordSet(dict, ignored)
  const words = Array.isArray(dict.words) ? dict.words : []
  let prefix = 0
  for (let index = 0; index < words.length; index++) {
    const key = normalizeLearningWord(words[index]?.word)
    if (key && !handledWords.has(key)) break
    prefix = index + 1
  }

  dict.lastLearnIndex = prefix
  dict.complete = words.every(word => {
    const key = normalizeLearningWord(word?.word)
    return !key || handledWords.has(key)
  })
}

/**
 * Seeds unit learning once from an old cursor before units are enabled. This
 * intentionally leaves FSRS cards untouched.
 */
export function seedUnitLearningFromLegacyProgress(dict: Dict): string[] {
  const learning = getBookLearning(dict)
  const end = Math.min(Math.max(Number(dict.lastLearnIndex) || 0, 0), dict.words.length)
  const masteredWords = new Set<string>()
  const skippedWords = new Set<string>()
  const existingWords = new Set<string>()
  const processedWords = new Set<string>()
  addNormalizedWords(masteredWords, learning.masteredWords)
  addNormalizedWords(skippedWords, learning.skippedWords)
  addNormalizedWords(existingWords, learning.learnedWords)
  addNormalizedWords(processedWords, learning.unitProcessedWords)

  const additions: string[] = []
  for (const word of dict.words.slice(0, end)) {
    const key = normalizeLearningWord(word?.word)
    if (!key) continue
    if (!processedWords.has(key)) processedWords.add(key)
    if (existingWords.has(key) || masteredWords.has(key) || skippedWords.has(key)) continue
    existingWords.add(key)
    additions.push(key)
  }
  learning.unitProcessedWords = Array.from(processedWords)
  if (additions.length) learning.learnedWords = [...learning.learnedWords, ...additions]
  return additions
}

/**
 * Applies a completed generated task. Progress follows the task's scanned end
 * index, rather than `new.length`, so ignored or manually skipped words cannot
 * leave the cursor behind. Only actually scheduled new words become learned.
 */
export function completeBookLearningTask(dict: Dict, task: TaskWords): string[] {
  const learning = getBookLearning(dict)
  const skipped = new Set(learning.skippedWords.map(normalizeLearningWord))
  const mastered = new Set(learning.masteredWords.map(normalizeLearningWord))

  if (hasBookUnits(dict)) {
    if (task.unitReview) return []

    const actualWords = new Set(getActualWordMap(dict).keys())
    const taskUnitId = task.unitId ?? learning.selectedUnitId ?? ''
    const scopedWords = new Set(getUnitWords(dict, taskUnitId).map(word => normalizeLearningWord(word.word)).filter(Boolean))
    const processedWords = new Set<string>()
    addNormalizedWords(processedWords, learning.unitProcessedWords)
    for (const word of task.unitScannedWords ?? task.new.map(item => item.word)) {
      const key = normalizeLearningWord(word)
      if (key && scopedWords.has(key)) processedWords.add(key)
    }
    learning.unitProcessedWords = Array.from(processedWords)

    const learned = task.new
      .map(word => normalizeLearningWord(word.word))
      .filter(word => word && actualWords.has(word) && scopedWords.has(word) && !skipped.has(word) && !mastered.has(word))

    learning.learnedWords = Array.from(new Set([...learning.learnedWords, ...learned]))
    refreshUnitBookProgress(dict)
    return learned
  }

  const start = Math.min(Math.max(Number(task.startIndex ?? dict.lastLearnIndex) || 0, 0), dict.words.length)
  const end = Math.min(Math.max(Number(task.endIndex ?? start + task.new.length) || start, start), dict.words.length)
  const learned = task.new
    .map(word => normalizeLearningWord(word.word))
    .filter(word => word && !skipped.has(word) && !mastered.has(word))

  learning.learnedWords = Array.from(new Set([...learning.learnedWords, ...learned]))
  dict.lastLearnIndex = end
  dict.complete = end >= dict.words.length
  return learned
}
