import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completeBookLearningTask,
  findOtherBookLearning,
  getBookLearning,
  getDefaultBookLearning,
  migrateLegacyFsrsToBookLearning,
  normalizeBookLearning,
} from '../src/utils/bookLearning.ts'

const word = (value: string) => ({ word: value })

test('book learning defaults to manual duplicate handling and normalizes explicit modes', () => {
  assert.equal(getDefaultBookLearning().duplicateMode, 'manual')
  assert.equal(normalizeBookLearning({ duplicateMode: 'off' }).duplicateMode, 'off')
  assert.equal(normalizeBookLearning({ duplicateMode: 'manual' }).duplicateMode, 'manual')
  assert.equal(normalizeBookLearning({ duplicateMode: 'auto' }).duplicateMode, 'auto')
  assert.equal(normalizeBookLearning({ duplicateMode: 'unsupported' }).duplicateMode, 'manual')
  assert.equal(normalizeBookLearning({ reviewRatio: 0.5, practiceMode: 6 }).reviewRatio, 0.5)
  assert.equal(normalizeBookLearning({ reviewRatio: 0.5, practiceMode: 6 }).practiceMode, 6)
  assert.equal(normalizeBookLearning({ reviewRatio: -1, practiceMode: 7 }).reviewRatio, undefined)
  assert.equal(normalizeBookLearning({ reviewRatio: -1, practiceMode: 7 }).practiceMode, undefined)
})

test('current learning keeps its stable object and other-book lookup is read-only', () => {
  const current: any = { id: 'current', name: '当前词书', words: [], lastLearnIndex: 0, learning: getDefaultBookLearning() }
  const other: any = { id: 'other', name: '另一词书', words: [], lastLearnIndex: 0 }
  const original = current.learning

  assert.equal(getBookLearning(current), original)
  assert.deepEqual(findOtherBookLearning([current, other], current, 'alpha'), [])
  assert.equal(other.learning, undefined)

  other.learning = { ...getDefaultBookLearning(), learnedWords: ['alpha'] }
  assert.deepEqual(findOtherBookLearning([current, other], current, ' ALPHA '), [
    { id: 'other', name: '另一词书', mastered: false },
  ])
})

test('the same word keeps independent cards for different books', () => {
  const first: any = { id: 'first', name: '第一本', words: [], lastLearnIndex: 0, learning: getDefaultBookLearning() }
  const second: any = { id: 'second', name: '第二本', words: [], lastLearnIndex: 0, learning: getDefaultBookLearning() }
  first.learning.fsrs.alpha = { due: 'first' }
  second.learning.fsrs.alpha = { due: 'second' }

  first.learning.fsrs.alpha.due = 'changed'
  assert.equal(second.learning.fsrs.alpha.due, 'second')
})

test('legacy FSRS migration uses only the completed range, clones cards, and preserves the source map', () => {
  const dict: any = {
    id: 'book',
    name: '词书',
    words: [word('Alpha'), word('Beta')],
    lastLearnIndex: 1,
    learning: getDefaultBookLearning(),
  }
  const alphaCard: any = { due: 'alpha-card', stability: 1 }
  const legacy: any = { Alpha: alphaCard, Beta: { due: 'beta-card' } }

  assert.equal(migrateLegacyFsrsToBookLearning(dict, legacy), true)
  assert.deepEqual(Object.keys(dict.learning.fsrs), ['alpha'])
  assert.equal(dict.learning.learnedWords.includes('alpha'), true)
  assert.equal(dict.learning.fsrs.alpha === alphaCard, false)
  assert.equal(legacy.Alpha, alphaCard)
  assert.equal(legacy.Beta.due, 'beta-card')
  assert.equal(migrateLegacyFsrsToBookLearning(dict, legacy), false)
})

test('completion advances by scanned endIndex and never treats a skipped word as learned', () => {
  const dict: any = {
    id: 'book',
    name: '词书',
    words: [word('Alpha'), word('Beta'), word('Gamma')],
    lastLearnIndex: 1,
    learning: { ...getDefaultBookLearning(), skippedWords: ['beta'] },
  }

  const learned = completeBookLearningTask(dict, {
    new: [word('Beta'), word('Gamma')],
    review: [],
    startIndex: 1,
    endIndex: 3,
  })
  assert.deepEqual(learned, ['gamma'])
  assert.deepEqual(dict.learning.learnedWords, ['gamma'])
  assert.equal(dict.lastLearnIndex, 3)
  assert.equal(dict.complete, true)
})
