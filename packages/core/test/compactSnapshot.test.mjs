import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { reactive, toRaw } from 'vue'

const source = readFileSync(new URL('../src/utils/index.ts', import.meta.url), 'utf8')
const start = source.indexOf('export function shakeCommonDict(')
const end = source.indexOf('export function isMobile(', start)
const js = ts.transpileModule(source.slice(start, end).replace('export function', 'function'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const cloneDeep = v => JSON.parse(JSON.stringify(v))
const compact = new Function('toRaw', 'cloneDeep', js + ';return shakeCommonDict;')(toRaw, cloneDeep)

test('compact snapshots preserve private content and all learning state without mutating the live store', () => {
  const store = reactive({ word: { studyIndex: 1, bookList: [
    { id: 'private', custom: true, words: [{ word: 'hello', note: 'mine' }], learning: { learnedWords: ['hello'], fsrs: { hello: { reps: 3 } } } },
    { id: 'public', words: [{ word: 'downloaded' }], learning: { learnedWords: ['downloaded'] } },
  ] }, article: { bookList: [{ custom: true, articles: [{ text: 'keep', sections: ['derived'] }] }, { articles: [{ text: 'downloaded' }] }] } })
  const snapshot = compact(store)
  assert.deepEqual(snapshot.word.bookList[0], cloneDeep(store.word.bookList[0]))
  assert.deepEqual(snapshot.word.bookList[1].words, [])
  assert.deepEqual(snapshot.word.bookList[1].learning, { learnedWords: ['downloaded'] })
  assert.equal(snapshot.article.bookList[0].articles[0].text, 'keep')
  assert.deepEqual(snapshot.article.bookList[0].articles[0].sections, [])
  assert.deepEqual(snapshot.article.bookList[1].articles, [])
  snapshot.word.bookList[0].words[0].note = 'changed'
  assert.equal(store.word.bookList[0].words[0].note, 'mine')
  assert.equal(store.word.bookList[1].words.length, 1)
  assert.deepEqual(store.article.bookList[0].articles[0].sections, ['derived'])
})
