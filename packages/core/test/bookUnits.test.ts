import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completeBookLearningTask,
  getBookHandledWordSet,
  getBookLearning,
  getDefaultBookLearning,
  getNewWordLimit,
  getUnitProgress,
  getUnitWords,
  isFollowingStudyUnit,
  normalizeBookLearning,
  normalizeBookUnits,
  seedUnitLearningFromLegacyProgress,
  selectUnitNewWords,
  selectUnitTaskWords,
} from '../src/utils/bookLearning.ts'

const word = (value: string) => ({ word: value })

function unitBook(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'book',
    name: '单元词书',
    words: [word('Alpha'), word('Beta'), word('Gamma')],
    lastLearnIndex: 0,
    complete: false,
    learning: { ...getDefaultBookLearning(), selectedUnitId: 'one' },
    units: [
      { id: 'one', name: '第一课', words: ['Alpha'] },
      { id: 'two', name: '第二课', words: ['Beta', 'Gamma'] },
    ],
    ...overrides,
  }
}

test('unit normalization trims and deduplicates identifiers and members safely', () => {
  assert.deepEqual(normalizeBookUnits([
    { id: ' one ', name: ' 第一课 ', words: [' Alpha ', 'alpha', null] },
    { id: 'one', name: '重复', words: ['Beta'] },
    { id: 'two', name: ' 第二课 ', words: ['ALPHA', ' Beta '] },
    { id: '', name: '无效', words: ['Gamma'] },
    null,
  ]), [
    { id: 'one', name: '第一课', words: ['alpha'] },
    { id: 'two', name: '第二课', words: ['alpha', 'beta'] },
  ])
})

test('a selected unit never fills a task with words from another unit', () => {
  const dict = unitBook()

  assert.deepEqual(selectUnitNewWords(dict, 10).map(item => item.word), ['Alpha'])
  completeBookLearningTask(dict, {
    new: [word('Alpha')],
    review: [],
    unitId: 'one',
    unitScannedWords: ['alpha'],
  })
  assert.deepEqual(selectUnitNewWords(dict, 10), [])
  assert.equal(getBookLearning(dict).learnedWords.includes('beta'), false)
})

test('finishing a later unit does not advance an earlier dictionary prefix', () => {
  const dict = unitBook({ learning: { ...getDefaultBookLearning(), selectedUnitId: 'two' } })

  completeBookLearningTask(dict, {
    new: [word('Beta'), word('Gamma')],
    review: [],
    unitId: 'two',
    unitScannedWords: ['beta', 'gamma'],
    startIndex: 1,
    endIndex: 3,
  })

  assert.equal(dict.lastLearnIndex, 0)
  assert.equal(dict.complete, false)
  assert.deepEqual(getUnitProgress(dict, 'two'), {
    total: 2,
    handled: 2,
    learned: 2,
    skipped: 0,
    remaining: 0,
  })
})

test('unit order stays stable when a missing member is later appended to the dictionary', () => {
  const dict = unitBook({
    words: [word('Alpha'), word('Gamma')],
    units: [
      { id: 'one', name: '第一课', words: ['Alpha', 'Beta'] },
      { id: 'two', name: '第二课', words: ['Gamma'] },
    ],
  })

  assert.deepEqual(getUnitWords(dict, '').map(item => item.word), ['Alpha', 'Gamma'])
  dict.words.push(word('Beta'))
  assert.deepEqual(getUnitWords(dict, '').map(item => item.word), ['Alpha', 'Beta', 'Gamma'])
})

test('normal books retain cursor-based completion behavior', () => {
  const dict: any = unitBook({ units: undefined, learning: getDefaultBookLearning(), lastLearnIndex: 1 })
  const learned = completeBookLearningTask(dict, {
    new: [word('Beta'), word('Gamma')],
    review: [],
    startIndex: 1,
    endIndex: 3,
  })

  assert.deepEqual(learned, ['beta', 'gamma'])
  assert.equal(dict.lastLearnIndex, 3)
  assert.equal(dict.complete, true)
})

test('JSON normalization keeps the selected unit and processed progress', () => {
  const learning = normalizeBookLearning(JSON.parse(JSON.stringify({
    ...getDefaultBookLearning(),
    selectedUnitId: ' one ',
    unitProcessedWords: [' Alpha ', 'alpha'],
  })))
  const dict = unitBook({ learning })

  assert.equal(learning.selectedUnitId, 'one')
  assert.deepEqual(learning.unitProcessedWords, ['alpha'])
  assert.deepEqual(getUnitProgress(dict, 'one'), {
    total: 1,
    handled: 1,
    learned: 0,
    skipped: 0,
    remaining: 0,
  })
})

test('first unit enablement seeds only the legacy prefix and leaves FSRS unchanged', () => {
  const alphaCard = { due: 'alpha' }
  const dict = unitBook({
    words: [word('Alpha'), word('Beta'), word('Gamma')],
    lastLearnIndex: 2,
    learning: {
      ...getDefaultBookLearning(),
      fsrs: { alpha: alphaCard },
      skippedWords: ['beta'],
    },
  })

  assert.deepEqual(seedUnitLearningFromLegacyProgress(dict), ['alpha'])
  assert.deepEqual(dict.learning.learnedWords, ['alpha'])
  assert.deepEqual(dict.learning.unitProcessedWords, ['alpha', 'beta'])
  assert.equal(dict.learning.fsrs.alpha, alphaCard)
  assert.equal(getBookHandledWordSet(dict).has('gamma'), false)
})

test('ignored words become processed only after task completion and survive an ignore-setting change', () => {
  const dict = unitBook({
    words: [word('Alpha'), word('Beta')],
    units: [{ id: 'one', name: '第一课', words: ['Alpha', 'Beta'] }],
  })
  const task = selectUnitTaskWords(dict, 1, new Set(['alpha']))

  assert.deepEqual(task.new.map(item => item.word), ['Beta'])
  assert.deepEqual(task.scanned, ['alpha', 'beta'])
  assert.equal(getBookHandledWordSet(dict).has('alpha'), false)

  completeBookLearningTask(dict, {
    new: task.new,
    review: [],
    unitId: 'one',
    unitScannedWords: task.scanned,
  })

  assert.deepEqual(getBookLearning(dict).unitProcessedWords, ['alpha', 'beta'])
  assert.deepEqual(getUnitProgress(dict, 'one'), {
    total: 2,
    handled: 2,
    learned: 1,
    skipped: 0,
    remaining: 0,
  })
  assert.deepEqual(selectUnitNewWords(dict, 10), [])
})

function quantityBook(): any {
  const first = Array.from({ length: 40 }, (_, index) => `first-${index}`)
  const second = Array.from({ length: 35 }, (_, index) => `second-${index}`)
  return unitBook({
    perDayStudyNumber: 20,
    words: [...first, ...second].map(word),
    units: [
      { id: 'one', name: '第一课', words: first },
      { id: 'two', name: '第二课', words: second },
    ],
  })
}

test('following a unit defaults to all remaining new words and adapts to unequal unit sizes', () => {
  const dict = quantityBook()
  assert.equal(isFollowingStudyUnit(dict), true)
  assert.equal(selectUnitTaskWords(dict, getNewWordLimit(dict)).new.length, 40)

  dict.learning.learnedWords = dict.units[0].words.slice(0, 10)
  dict.learning.skippedWords = ['first-10']
  const task = selectUnitTaskWords(dict, getNewWordLimit(dict), new Set(['first-11']))
  assert.deepEqual(task.new.map(item => item.word), dict.units[0].words.slice(12))
  assert.equal(task.new.length, 28)

  dict.learning.selectedUnitId = 'two'
  assert.equal(selectUnitTaskWords(dict, getNewWordLimit(dict)).new.length, 35)
  assert.equal(dict.perDayStudyNumber, 20)
})

test('custom quantity caps new words within the selected unit without filling from the next one', () => {
  const dict = quantityBook()
  dict.learning.newWordMode = 'custom'
  assert.equal(isFollowingStudyUnit(dict), false)
  assert.equal(selectUnitTaskWords(dict, getNewWordLimit(dict)).new.length, 20)

  dict.learning.learnedWords = dict.units[0].words.slice(0, 35)
  assert.deepEqual(selectUnitTaskWords(dict, getNewWordLimit(dict)).new.map(item => item.word), dict.units[0].words.slice(35))
})

test('whole-book and ordinary books retain the numeric quantity even when follow-unit mode is saved', () => {
  const dict = quantityBook()
  dict.learning.newWordMode = 'unit'
  dict.learning.selectedUnitId = ''
  assert.equal(isFollowingStudyUnit(dict), false)
  assert.equal(getNewWordLimit(dict), 20)
  assert.equal(selectUnitTaskWords(dict, getNewWordLimit(dict)).new.length, 20)

  dict.learning.selectedUnitId = 'one'
  dict.units = undefined
  assert.equal(isFollowingStudyUnit(dict), false)
  assert.equal(getNewWordLimit(dict), 20)
})

test('new-word mode survives serialization and invalid values fall back to the unit default', () => {
  for (const mode of ['unit', 'custom']) {
    const learning = normalizeBookLearning(JSON.parse(JSON.stringify({
      ...getDefaultBookLearning(), selectedUnitId: 'one', newWordMode: mode,
    })))
    const dict = quantityBook()
    dict.learning = learning
    assert.equal(getBookLearning(dict), learning)
    assert.equal(learning.newWordMode, mode)
    assert.equal(isFollowingStudyUnit(dict), mode === 'unit')
  }
  const dict = quantityBook()
  dict.learning.newWordMode = 'invalid'
  assert.equal(getBookLearning(dict).newWordMode, undefined)
  assert.equal(isFollowingStudyUnit(dict), true)
})
