import test from 'node:test'
import assert from 'node:assert/strict'
import { planStudyTask } from '../src/learning/planStudyTask.ts'
import { prepareStudyBook, applyStudyCardCleanup } from '../src/learning/prepareStudyBook.ts'
import { getDefaultBookLearning } from '../src/utils/bookLearning.ts'
import type { Dict } from '../src/types'

const now = Date.parse('2026-09-21T12:00:00Z')
const wordKeys = (words: any[]) => words.map(word => word.word)
function book(overrides: any = {}): Dict {
  return { id: 'book', words: ['a', 'b', 'c', 'd', 'e', 'f'].map(word => ({ word })), length: 6,
    lastLearnIndex: 2, perDayStudyNumber: 2, complete: false, learning: getDefaultBookLearning(), ...overrides } as Dict
}
function plan(b: Dict, ignored = new Set<string>(), ratio = 1) {
  return planStudyTask({ book: b, ignoredWords: ignored, defaultReviewRatio: ratio, now, random: () => .999 })
}
function freeze(value: any) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  Object.values(value).forEach(freeze); Object.freeze(value)
}

test('a fresh 1940-word book configured for 40 creates a 40-word task', () => {
  const b = book({ words: Array.from({ length: 1940 }, (_, i) => ({ word: `pet-${i}` })), length: 1940, lastLearnIndex: 0, perDayStudyNumber: 40 })
  const first = plan(b).task
  const reopened = plan(b).task
  assert.equal(first.new.length, 40)
  assert.equal(first.review.length, 0)
  assert.deepEqual(wordKeys(first.new), wordKeys(reopened.new))
})

test('ordinary books retain cursor, ignored words and learned fallback without input writes', () => {
  const b = book(); freeze(b)
  const p = plan(b, new Set(['c']))
  assert.deepEqual(wordKeys(p.task.new), ['d', 'e'])
  assert.equal(p.task.startIndex, 2); assert.equal(p.task.endIndex, 5)
  assert.deepEqual(wordKeys(p.task.review), ['b', 'a'])
})
test('unit scope supports whole remaining unit or quantity without crossing unit boundary', () => {
  const b = book({ units: [{ id: 'one', name: 'One', words: ['a', 'c', 'e'] }, { id: 'two', name: 'Two', words: ['b', 'd', 'f'] }] })
  b.learning.selectedUnitId = 'two'; b.learning.learnedWords = ['b']
  b.perDayStudyNumber = 1
  assert.deepEqual(wordKeys(plan(b).task.new), ['d', 'f'])
  b.learning.newWordMode = 'custom'
  assert.deepEqual(wordKeys(plan(b).task.new), ['d'])
  b.learning.selectedUnitId = ''
  assert.deepEqual(wordKeys(plan(b).task.new), ['a'])
})
test('due review is book-wide, earliest first before shuffle, future cards never fill quota', () => {
  const b = book({ units: [{ id: 'one', name: 'One', words: ['a', 'b'] }, { id: 'two', name: 'Two', words: ['c', 'd', 'e', 'f'] }] })
  b.learning.selectedUnitId = 'two'; b.learning.newWordMode = 'custom'
  b.learning.learnedWords = ['a', 'b', 'f']; b.learning.skippedWords = ['e']
  b.learning.fsrs = { a: { due: new Date(now - 10) }, b: { due: new Date(now - 20) }, f: { due: new Date(now + 100) }, outside: { due: new Date(now - 30) } } as any
  freeze(b)
  const p = plan(b)
  assert.deepEqual(wordKeys(p.task.new), ['c', 'd'])
  assert.deepEqual(wordKeys(p.task.review), ['b', 'a'])
})
test('end-of-book review works with zero ratio and preserves content version', () => {
  const b = book({ lastLearnIndex: 6, library: { version: 7 } })
  freeze(b)
  const p = plan(b, new Set(), 0)
  assert.deepEqual(p.task.new, [])
  assert.deepEqual(wordKeys(p.task.review), ['f', 'e'])
  assert.equal(p.task.libraryVersion, 7)
})
test('preview reports legacy cleanup without deleting cards; applying it is explicit', () => {
  const b = book(); b.learning.fsrs = { a: { due: new Date(now - 1) } } as any
  const p = plan(b, new Set(['a']))
  assert.deepEqual(p.ignoredCardKeys, ['a']); assert.ok(b.learning.fsrs.a)
  applyStudyCardCleanup(b, p.ignoredCardKeys)
  assert.equal(b.learning.fsrs.a, undefined)
})
test('missing learning and unloaded content preview does not normalize or reset source progress', () => {
  const b = book({ words: [], lastLearnIndex: 82, learning: undefined }); freeze(b)
  assert.deepEqual(plan(b).task.new, [])
  assert.equal(b.lastLearnIndex, 82); assert.equal(b.learning, undefined)
})
test('legacy preparation is repeatable and leaves other-book cards and unloaded books alone', () => {
  const b = book(); const legacy = { a: { due: new Date(now) }, other: { due: new Date(now) } } as any
  const before = structuredClone(legacy)
  prepareStudyBook(b, legacy, new Set())
  const first = structuredClone(b)
  prepareStudyBook(b, legacy, new Set())
  assert.deepEqual(b, first); assert.deepEqual(legacy, before)
  assert.ok(b.learning.fsrs.a); assert.equal(b.learning.fsrs.other, undefined)
  const unloaded = book({ words: [], lastLearnIndex: 82 }); const copy = structuredClone(unloaded)
  prepareStudyBook(unloaded, legacy, new Set()); assert.deepEqual(unloaded, copy)
})
