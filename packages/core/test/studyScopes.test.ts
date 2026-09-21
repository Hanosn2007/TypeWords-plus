import test from 'node:test'
import assert from 'node:assert/strict'
import { upgradePracticeScopes, getPracticeWordCacheFromPayload, practiceScopeKey, cacheScopeKey } from '../src/utils/cache.ts'
import { getDefaultBookLearning, getUnitProgress, isCompletedPracticeCache } from '../src/utils/bookLearning.ts'
import { collectStudyStatistics } from '../src/utils/studyStatistics.ts'

const cache = (unitId: string, free = false) => ({ dictId: 'book', practiceMode: free ? 1 : 0, libraryVersion: 2, taskWords: { unitId, new: [{word:'a'}], review: [] }, practiceData: { index: 3, words: [] }, statStoreData: { startDate: 10, spend: 900, stage: 1 } }) as any

test('v2 upgrade preserves the entire task and leaves source untouched; repeated upgrade is stable', () => {
  const old = {schemaVersion:2 as const, entries:{book:{data:cache('lesson-4'),updatedAt:'2026-09-21'}}}
  const before = structuredClone(old)
  const next = upgradePracticeScopes(old)
  assert.equal(next.schemaVersion,3)
  assert.deepEqual(getPracticeWordCacheFromPayload(next,'book','lesson-4'),old.entries.book.data)
  assert.deepEqual(old,before)
  assert.deepEqual(upgradePracticeScopes(next),next)
})
test('each unit and free practice retains its own task; clearing one cannot erase another', () => {
  const next = upgradePracticeScopes(null)
  for(const c of [cache('one'),cache('two'),cache('one',true)]) next.entries[cacheScopeKey(c)]={data:c,updatedAt:'2026-09-21'}
  next.entries[practiceScopeKey('book','one')]={data:null,updatedAt:'2026-09-22'}
  assert.equal(getPracticeWordCacheFromPayload(next,'book','one'),null)
  assert.equal(getPracticeWordCacheFromPayload(next,'book','two')?.practiceMode,0)
  assert.equal(getPracticeWordCacheFromPayload(next,'book','one',true)?.practiceMode,1)
})
test('unloaded unit book has identical progress to loaded book, without changing learning records', () => {
  const book:any={words:[{word:'a'},{word:'b'},{word:'c'}],units:[{id:'one',name:'One',words:['a','b']},{id:'two',name:'Two',words:['b','c']}],learning:{...getDefaultBookLearning(),learnedWords:['a'],skippedWords:['b']}}
  const expected=getUnitProgress(book)
  book.words=[]
  assert.deepEqual(getUnitProgress(book),expected)
  assert.equal(expected.total,3);assert.equal(expected.handled,2)
})
test('completion markers remain independent across units', () => {
  const book:any={id:'book',learning:{...getDefaultBookLearning(),lastCompletedPracticeAt:20,completedPracticeByScope:{'["one","study"]':10,'["two","study"]':20}}}
  assert.equal(isCompletedPracticeCache(book,cache('one')),true)
  assert.equal(isCompletedPracticeCache(book,cache('two')),false)
  assert.equal(isCompletedPracticeCache(book,cache('one',true)),false)
})
test('statistics include every unfinished unit but never the same cache twice', () => {
  const next=upgradePracticeScopes(null)
  for(const c of [cache('one'),cache('two')]) next.entries[cacheScopeKey(c)]={data:c,updatedAt:'2026-09-21'}
  const rows=collectStudyStatistics([{id:'book',name:'Book',statistics:[],learning:getDefaultBookLearning()}] as any,next,99)
  assert.equal(rows.reduce((sum,row)=>sum+row.spend,0),1800)
})
