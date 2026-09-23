import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/composables/usePracticePersistence.ts', import.meta.url), 'utf8')
const code = source.slice(source.indexOf('function serializePracticeData('), source.indexOf('async function restorePracticeWordCache('))
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const capture = new Function('useBaseStore', 'stripPracticeTimeAccounting', `${js}; return serializePracticeWordCache`)(
  () => ({ word: { bookList: [] } }), value => value
)

test('captures progress without traversing word definitions or examples', () => {
  const word = { word: 'apple', get sentences() { throw Error('Word content must not be copied') } }
  const data = { dictId: 'test', taskWords: { new: [word], review: [] }, practiceData: { words: [word], wrongWords: [], index: 0 }, statStoreData: { spend: 10 } }
  const result = capture(data, true)
  assert.deepEqual(result.practiceData.wordsStr, ['apple'])
  assert.deepEqual(result.taskWordsStr.new, ['apple'])
})

test('queued checkpoint stays detached from subsequent answers and undo state', () => {
  const word = { word: 'apple' }
  const state = { words: [word], wrongWords: [word], index: 0, allWrongWords: ['apple'], question: { candidates: ['a', 'b'], correctIndex: 1 } }
  const data = { dictId: 'test', taskWords: { new: [word], review: [], unitId: 'lesson1' }, practiceData: state, statStoreData: { spend: 10, days: { today: 10 } }, skipCheckpoint: { stage: 'follow', practiceType: 'spell', practiceData: state } }
  const result = capture(data, true)
  state.index = 1; state.allWrongWords.push('pear'); state.question.candidates[0] = 'changed'
  data.statStoreData.days.today = 99; data.taskWords.unitId = 'lesson2'
  assert.equal(result.practiceData.index, 0)
  assert.deepEqual(result.practiceData.allWrongWords, ['apple'])
  assert.equal(result.skipCheckpoint.practiceData.question.candidates[0], 'a')
  assert.equal(result.statStoreData.days.today, 10)
  assert.equal(result.taskWordsStr.unitId, 'lesson1')
})
