import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLibraryRelease, applyLoadedLibraryBook, getPendingLibraryVersion, hasVisibleBookUnits, librarySummaryToResource } from '../src/utils/libraryContent.ts'
import { completeBookLearningTask, getDefaultBookLearning, getUnitProgress, selectUnitTaskWords } from '../src/utils/bookLearning.ts'

const makeBook = (): any => ({
  id: 'library-a', name: 'Old', words: [], units: [], length: 0, custom: false,
  library: { bookId: 'library-a', version: 1 },
  lastLearnIndex: 0, complete: false, perDayStudyNumber: 20, statistics: [{ total: 2 }],
  learning: { ...getDefaultBookLearning(), reviewRatio: 0.5, practiceMode: 2 },
})
const release = (version = 1, words = ['alpha', 'beta'], units: any[] = []): any => ({
  id: 'library-a', version, updatedAt: '', content: {
    name: `Version ${version}`, description: 'Public', category: '课程', tags: ['英语'],
    language: 'en', translateLanguage: 'zh-CN', recommended: true, sortOrder: 0,
    words: words.map(word => ({ word, trans: [{ pos: 'n.', cn: `meaning ${version}` }] })), units,
  },
})

test('release updates definitions and order while preserving personal state and deleted-word history', () => {
  const book = applyLibraryRelease(makeBook(), release())
  const learning = book.learning!
  learning.learnedWords = ['alpha', 'removed']
  learning.fsrs.alpha = { stability: 8 } as any
  const statistics = book.statistics
  const next = applyLibraryRelease(book, release(2, ['beta', 'alpha', 'new']))
  assert.equal(next.id, book.id)
  assert.equal(next.learning, learning)
  assert.equal(next.statistics, statistics)
  assert.equal(next.perDayStudyNumber, 20)
  assert.equal(next.learning?.fsrs.alpha.stability, 8)
  assert.deepEqual(next.learning?.learnedWords, ['alpha', 'removed'])
  assert.equal(next.words[1].trans[0].cn, 'meaning 2')
  assert.deepEqual(selectUnitTaskWords(next, 20).new.map(word => word.word), ['beta', 'new'])
  assert.equal(next.complete, false)
  assert.equal(book.words[0].trans[0].cn, 'meaning 1')
})

test('whole-book releases use hidden stable units and retain normal daily limits', () => {
  const book = applyLibraryRelease(makeBook(), release())
  assert.equal(hasVisibleBookUnits(book), false)
  assert.equal(book.learning?.selectedUnitId, '')
  assert.equal(book.learning?.newWordMode, 'custom')
  assert.equal(book.perDayStudyNumber, 20)
  completeBookLearningTask(book, { new: [book.words[0]], review: [], unitId: '', unitScannedWords: ['alpha'] })
  const next = applyLibraryRelease(book, release(2, ['added', 'beta', 'alpha']))
  assert.equal(next.lastLearnIndex, 0)
  assert.equal(getUnitProgress(next).handled, 1)
  assert.deepEqual(selectUnitTaskWords(next, 20).new.map(word => word.word), ['added', 'beta'])
})

test('unit rename and movement retain handled membership; deleting the selection returns to whole book', () => {
  const book = applyLibraryRelease(makeBook(), release(1, ['alpha', 'beta'], [{ id: 'u1', name: 'First', words: ['alpha'] }]))
  book.learning!.selectedUnitId = 'u1'
  book.learning!.learnedWords = ['alpha']
  const renamed = applyLibraryRelease(book, release(2, ['beta', 'alpha'], [{ id: 'u1', name: 'Renamed', words: ['beta', 'alpha'] }]))
  assert.equal(hasVisibleBookUnits(renamed), true)
  assert.equal(renamed.learning?.selectedUnitId, 'u1')
  assert.equal(getUnitProgress(renamed, 'u1').handled, 1)
  const removed = applyLibraryRelease(renamed, release(3, ['beta'], [{ id: 'u2', name: 'Second', words: ['beta'] }]))
  assert.equal(removed.learning?.selectedUnitId, '')
  assert.deepEqual(removed.learning?.learnedWords, ['alpha'])
})

test('catalogue detail cannot overwrite an existing student book with empty personal defaults', () => {
  const stored = applyLibraryRelease(makeBook(), release())
  stored.perDayStudyNumber = 7
  stored.learning!.learnedWords = ['alpha']
  const openedFromCatalog = applyLibraryRelease(makeBook(), release(2))
  const joined = applyLoadedLibraryBook(stored, openedFromCatalog)
  assert.equal(joined.learning, stored.learning)
  assert.equal(joined.statistics, stored.statistics)
  assert.equal(joined.perDayStudyNumber, 7)
  assert.equal(joined.library?.version, 2)
  assert.equal(getUnitProgress(joined).handled, 1)
})

test('unfinished cache pins its version, while completed or empty caches do not block updates', () => {
  const book = makeBook()
  book.library.version = 4
  const cache = { libraryVersion: 1, taskWordsStr: { new: ['alpha'], review: [] }, statStoreData: { startDate: 100 } }
  assert.equal(getPendingLibraryVersion(book, cache), 1)
  assert.equal(getPendingLibraryVersion(book, { ...cache, libraryVersion: undefined }), 4)
  assert.equal(getPendingLibraryVersion(book, { ...cache, taskWordsStr: { new: [], review: [] } }), undefined)
  book.learning.lastCompletedPracticeAt = 100
  assert.equal(getPendingLibraryVersion(book, cache), undefined)
  assert.equal(getPendingLibraryVersion(book, null), undefined)
})

test('shared catalogue resources use stable IDs and never borrow private-copy sourceId', () => {
  const entry = librarySummaryToResource({ ...release().content, id: 'library-a', version: 3, length: 2, updatedAt: '' })
  assert.equal(entry.id, 'library-a')
  assert.deepEqual(entry.library, { bookId: 'library-a', version: 3 })
  assert.equal('sourceId' in entry, false)
  assert.throws(() => applyLibraryRelease({ ...makeBook(), id: 'library-b' }, release()), /不匹配/)
})
