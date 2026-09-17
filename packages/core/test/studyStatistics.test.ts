import assert from 'node:assert/strict'
import test from 'node:test'
import { collectStudyStatistics } from '../src/utils/studyStatistics.ts'
import { isCompletedPracticeCache, normalizeBookLearning } from '../src/utils/bookLearning.ts'

const day = new Date(2026, 8, 10, 12).getTime()
const state = (spend: number, startDate = day) => ({ stage: 0, spend, startDate, segments: [[startDate, startDate + spend]], total: 2, newWordNumber: 2, reviewWordNumber: 0, wrong: 0 })
const entry = (dictId: string, spend: number) => ({ updatedAt: '2026-09-10T12:00:00Z', data: { dictId, statStoreData: state(spend) } })
const books: any[] = [{ id: 'a', name: 'A', statistics: [{ startDate: day - 86400000, spend: 60_000, total: 1, new: 1, review: 0, wrong: 0 }] }, { id: 'b', name: 'B', statistics: [] }]
const sum = (rows: ReturnType<typeof collectStudyStatistics>) => rows.reduce((s, r) => s + r.spend, 0)

test('all-book total and daily rows include both unfinished books independently of selection order', () => {
  const bundle: any = { schemaVersion: 2, entries: { a: entry('a', 30_000), b: entry('b', 3000) } }
  const before = structuredClone(bundle)
  const rows = collectStudyStatistics(books, bundle, 13)
  assert.equal(sum(rows), 93_000)
  assert.deepEqual(rows.filter(r => r.pending).map(r => [r.dictName, r.spend]), [['A', 30_000], ['B', 3000]])
  assert.equal(sum(collectStudyStatistics([...books].reverse(), bundle, 13)), 93_000)
  assert.deepEqual(bundle, before)
})

test('settling A and tombstoning only A keeps the total constant and B intact', () => {
  const bundle: any = { schemaVersion: 2, entries: { a: entry('a', 30_000), b: entry('b', 3000) } }
  const rows = collectStudyStatistics(books, bundle, 13)
  const afterBooks = structuredClone(books)
  afterBooks[0].statistics.push(...rows.filter(r => r.pending && r.dictId === 'a'))
  const afterBundle = structuredClone(bundle)
  afterBundle.entries.a.data = null
  assert.equal(sum(collectStudyStatistics(afterBooks, afterBundle, 13)), sum(rows))
  assert.deepEqual(afterBundle.entries.b, bundle.entries.b)
})

test('deleted books, wrong ownership, unresolved legacy, settled-stage and zero-time caches do not add phantom statistics', () => {
  const bundle: any = { schemaVersion: 2, entries: { a: entry('b', 9999), b: entry('b', 0), deleted: entry('deleted', 9999) }, unresolvedLegacy: entry('unknown', 9999) }
  assert.equal(sum(collectStudyStatistics(books, bundle, 13)), 60_000)
  bundle.entries.b = entry('b', 9999)
  bundle.entries.b.data.statStoreData.stage = 13
  assert.equal(sum(collectStudyStatistics(books, bundle, 13)), 60_000)
  assert.equal(collectStudyStatistics(books, bundle, 13).length, 1)
})

test('old conflicting timer fields keep the saved 91m3s instead of adding 21m52s at aggregation or settlement', () => {
  const bundle: any = { schemaVersion: 2, entries: { a: entry('a', 5_463_000), b: entry('b', 3000) } }
  bundle.entries.a.data.statStoreData.segments = [[day - 86400000, day - 86400000 + 6_775_957]]
  const before = structuredClone(bundle)
  const rows = collectStudyStatistics(books, bundle, 13)
  assert.equal(sum(rows), 60_000 + 5_463_000 + 3000)
  assert.deepEqual(bundle, before)
  assert.equal(rows.filter(r => r.pending && r.dictId === 'a').reduce((s, r) => s + r.spend, 0), 5_463_000)
})

test('refresh after dictionary settlement but before cache clear cannot count or restore the same round again', () => {
  const bundle: any = { schemaVersion: 2, entries: { a: entry('a', 30_000), b: entry('b', 3000) } }
  const completedBooks = structuredClone(books)
  completedBooks[0].statistics.push({ startDate: day, spend: 30_000, total: 2, new: 2, review: 0, wrong: 0 })
  completedBooks[0].learning = normalizeBookLearning({ lastCompletedPracticeAt: day })
  assert.equal(isCompletedPracticeCache(completedBooks[0], bundle.entries.a.data), true)
  assert.equal(sum(collectStudyStatistics(completedBooks, bundle, 13)), 93_000)
  assert.equal(isCompletedPracticeCache(completedBooks[0], bundle.entries.b.data), false)
  const nextRound = structuredClone(bundle.entries.a.data)
  nextRound.statStoreData.startDate++
  assert.equal(isCompletedPracticeCache(completedBooks[0], nextRound), false)
  // An explicit undo restores the learning checkpoint from before settlement.
  completedBooks[0].learning = normalizeBookLearning({})
  assert.equal(isCompletedPracticeCache(completedBooks[0], bundle.entries.a.data), false)
  assert.equal(isCompletedPracticeCache(books[0], {}), false)
  assert.equal(normalizeBookLearning({ lastCompletedPracticeAt: NaN }).lastCompletedPracticeAt, undefined)
})
