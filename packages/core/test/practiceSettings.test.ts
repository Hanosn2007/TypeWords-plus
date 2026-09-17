import assert from 'node:assert/strict'
import test from 'node:test'
import { hasPracticeAnswerProgress, shouldRebuildPracticeForSettings } from '../src/utils/practiceSettings.ts'

const custom = { newWordMode: 'custom' as const, perDayStudyNumber: 20, reviewRatio: 1 }
const unit = { ...custom, newWordMode: 'unit' as const }

function cache(overrides: Record<string, unknown> = {}): any {
  return {
    dictId: 'book',
    taskWords: { new: Array.from({ length: 20 }, (_, i) => ({ word: String(i) })), review: [], settings: custom },
    practiceData: { index: 0, words: [], wrongWords: [], excludeWords: [], allWrongWords: [], wrongTimes: 0, wrongTimesMap: {}, ratingMap: {}, isTypingWrongWord: false },
    statStoreData: { stage: 0, inputWordNumber: 0, skippedWordNumber: 0, wrong: 0, spend: 30_000, segments: [[1000, 31000]] },
    ...overrides,
  }
}

test('opening the first word and waiting or caching it does not count as lost answer progress', () => {
  assert.equal(hasPracticeAnswerProgress(null, 0), false)
  assert.equal(hasPracticeAnswerProgress(cache(), 0), false)
})

test('first-word answers, errors, skipped words, and stage checkpoints require a warning', () => {
  const variants = [
    { index: 1 }, { wrongTimes: 1 }, { ratingMap: { alpha: 3 } },
    { wrongTimesMap: { alpha: 0 } }, { excludeWords: ['alpha'] },
    { wrongWords: [{ word: 'alpha' }] }, { allWrongWords: ['alpha'] },
    { duplicateSkippedWords: ['alpha'] }, { isTypingWrongWord: true },
  ]
  for (const variant of variants) {
    const task = cache()
    Object.assign(task.practiceData, variant)
    assert.equal(hasPracticeAnswerProgress(task, 0), true, JSON.stringify(variant))
  }
  assert.equal(hasPracticeAnswerProgress(cache({ skipCheckpoint: { stage: 0 } }), 0), true)
  assert.equal(hasPracticeAnswerProgress(cache({ statStoreData: { stage: 1 } }), 0), true)
  assert.equal(hasPracticeAnswerProgress(cache({ statStoreData: { stage: 0, inputWordNumber: 1 } }), 0), true)
})

test('compact persisted first-word errors are recognized before restoring the practice page', () => {
  const task = cache()
  task.taskWordsStr = { new: ['alpha'], review: [], settings: custom }
  delete task.taskWords
  task.practiceData.wordsStr = ['alpha']
  task.practiceData.wrongWordsStr = ['alpha']
  delete task.practiceData.words
  delete task.practiceData.wrongWords
  assert.equal(hasPracticeAnswerProgress(task, 0), true)
})

test('only task-setting changes restart a round; unrelated duplicate-policy edits do not', () => {
  assert.equal(shouldRebuildPracticeForSettings(custom, custom, cache(), false), false)
  assert.equal(shouldRebuildPracticeForSettings(custom, custom, cache(), true), false)
  assert.equal(shouldRebuildPracticeForSettings(custom, unit, cache(), false), true)
  assert.equal(shouldRebuildPracticeForSettings(custom, { ...custom, perDayStudyNumber: 10 }, cache(), false), true)
  assert.equal(shouldRebuildPracticeForSettings(custom, { ...custom, reviewRatio: 0 }, cache(), false), true)
  assert.equal(shouldRebuildPracticeForSettings(custom, unit, null, false), true)
})

test('a task created with older settings is replaced even when the book already stores the new settings', () => {
  assert.equal(shouldRebuildPracticeForSettings(unit, unit, cache(), false), true)
  assert.equal(shouldRebuildPracticeForSettings(unit, unit, cache(), true), false)
  const old = cache()
  delete old.taskWords.settings
  assert.equal(shouldRebuildPracticeForSettings(unit, unit, old, false, 40), true)
  assert.equal(shouldRebuildPracticeForSettings(unit, unit, old, true, 40), false)
  assert.equal(shouldRebuildPracticeForSettings(unit, unit, old, false, 20), false)
  old.taskWords.new = []
  old.taskWords.unitReview = true
  assert.equal(shouldRebuildPracticeForSettings(unit, unit, old, false, 40), false)
})
