import type { Dict, DictResource, Word } from '../types/types.ts'
import type { LibraryBookSummary, LibraryRelease } from '../types/library.ts'
import { getBookLearning, normalizeBookUnits, refreshUnitBookProgress } from './bookLearning.ts'

/** Internal only: whole-book releases still use word-set progress when reordered. */
export const LIBRARY_WHOLE_BOOK_UNIT = '__typewords_library_whole_book__'

export function hasVisibleBookUnits(book: Pick<Dict, 'units' | 'library'>): boolean {
  return !!book.units?.length && !(book.library && book.units.length === 1 && book.units[0].id === LIBRARY_WHOLE_BOOK_UNIT)
}

export function librarySummaryToResource(book: LibraryBookSummary): DictResource {
  return {
    id: book.id, enName: book.id, name: book.name, description: book.description,
    category: book.category || '共享词书', tags: book.tags?.length ? book.tags : ['所有'],
    language: book.language as Dict['language'], translateLanguage: book.translateLanguage as Dict['translateLanguage'], length: book.length,
    url: '', library: { bookId: book.id, version: book.version },
    ...(book.cover ? { cover: book.cover } : {}),
  }
}

/** Copy only published fields. Personal learning, statistics and settings stay owned by the book. */
export function applyLibraryRelease(book: Dict, release: LibraryRelease): Dict {
  if (String(book.id) !== release.id || (book.library && book.library.bookId !== release.id)) {
    throw new Error('词书版本与当前词书不匹配')
  }
  const content = release.content
  const words: Word[] = structuredClone(content.words).map(word => ({
    id: `${release.id}:${String(word.word).trim().toLowerCase()}`,
    custom: false, phonetic0: '', phonetic1: '', trans: [], sentences: [], phrases: [],
    synos: [], relWords: { root: '', rels: [] }, etymology: [], ...word, word: word.word ?? '',
  }))
  const explicitUnits = normalizeBookUnits(content.units)
  const units = explicitUnits.length ? explicitUnits : [{
    id: LIBRARY_WHOLE_BOOK_UNIT, name: '整本词书', words: words.map(word => word.word),
  }]
  const learning = getBookLearning(book)
  const next: Dict = {
    ...book,
    name: content.name, description: content.description, category: content.category || '共享词书',
    tags: [...content.tags], language: content.language as Dict['language'], translateLanguage: content.translateLanguage as Dict['translateLanguage'],
    cover: content.cover ?? '', words, units, length: words.length,
    custom: false, system: false, url: '', enName: release.id,
    library: { bookId: release.id, version: release.version }, learning,
  }
  if (!explicitUnits.length || (learning.selectedUnitId && !units.some(unit => unit.id === learning.selectedUnitId))) {
    learning.selectedUnitId = ''
  }
  if (!explicitUnits.length) learning.newWordMode = 'custom'
  refreshUnitBookProgress(next)
  return next
}

/** A catalogue/detail view may have no personal state; joining it must retain the existing student's record. */
export function applyLoadedLibraryBook(book: Dict, loaded: Dict): Dict {
  if (!loaded.library || String(book.id) !== String(loaded.id)) throw new Error('词书来源不匹配')
  const next = {
    ...book, name: loaded.name, description: loaded.description, category: loaded.category,
    tags: loaded.tags, language: loaded.language, translateLanguage: loaded.translateLanguage,
    cover: loaded.cover, words: loaded.words, units: loaded.units, length: loaded.length,
    library: loaded.library, enName: loaded.enName, url: loaded.url,
  }
  const learning = getBookLearning(next)
  if (learning.selectedUnitId && !next.units?.some(unit => unit.id === learning.selectedUnitId)) learning.selectedUnitId = ''
  if (!hasVisibleBookUnits(next)) { learning.selectedUnitId = ''; learning.newWordMode = 'custom' }
  refreshUnitBookProgress(next)
  return next
}

export function getPendingLibraryVersion(book: Dict, cache: {
  libraryVersion?: number
  statStoreData?: { startDate?: number }
  taskWords?: { new: unknown[]; review: unknown[] }
  taskWordsStr?: { new: string[]; review: string[] }
} | null | undefined): number | undefined {
  if (!cache || !book.library) return undefined
  if (book.learning?.lastCompletedPracticeAt != null &&
    book.learning.lastCompletedPracticeAt === cache.statStoreData?.startDate) return undefined
  const task = cache.taskWordsStr ?? cache.taskWords
  if (!task || (!task.new?.length && !task.review?.length)) return undefined
  return cache.libraryVersion ?? book.library.version
}
