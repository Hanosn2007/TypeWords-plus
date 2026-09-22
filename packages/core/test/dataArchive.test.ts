import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeArchive, encodeArchive, validateAttachments, DATA_KEYS } from '../src/utils/dataArchive.ts'
import { historyDate, historyFingerprint, retainDates } from '../src/utils/historyPolicy.ts'

export function fixture() {
  return [
    { type: 'dict', data_version: 4, data: { word: { studyIndex: 0, bookList: [{ id: 'library-keep-id', name: '示例词书', words: [{ word: 'apple' }], articles: [], statistics: [{spend: 90000}], library: {version:7}, units:[{id:'unit-1',name:'Lesson 1',words:['apple']}], learning: {fsrs:{apple:{reps:4,lapses:1,stability:12.5}},learnedWords:['apple'],masteredWords:[],skippedWords:[],completedTaskIds:['completed-1']} }] }, article: { studyIndex: -1, bookList: [] } } },
    { type: 'setting', data_version: 25, data: { fontSize: 22 } },
    { type: 'practice_word', data_version: 3, data: {schemaVersion:3,entries:{'["library-keep-id","unit-1","study"]':{updatedAt:'2026-09-22T00:00:00Z',data:{dictId:'library-keep-id',libraryVersion:7,taskWordsStr:{new:['apple'],review:[],taskId:'task-1',unitId:'unit-1'},practiceData:{wordsStr:['apple'],wrongWordsStr:[],index:0,stage:2},statStoreData:{spend:2000,wrong:1}}}}} },
    { type: 'practice_article', data_version: 1, data: null },
  ]
}
test('archive and four legacy envelopes round-trip complete scoped learning state', () => {
 const rows=fixture(), encoded=encodeArchive(rows)
 assert.deepEqual(decodeArchive(encoded),rows)
 const val=Object.fromEntries(rows.map(r=>[r.type==='dict'||r.type==='setting'?r.type:DATA_KEYS[r.type],{val:r.data,version:r.data_version}]))
 for(const input of [{version:5,val},{meta:{createdAt:1},data:val},{entries:rows.map(r=>[DATA_KEYS[r.type],JSON.stringify({val:r.data,version:r.data_version})])},{local:rows,remote:{revision:2,rows}}]) assert.deepEqual(decodeArchive(input),rows)
 assert.deepEqual(decodeArchive({local:[],remote:{rows}},'remote'),rows)
})
test('future, partial, broken task and ambiguous formats are rejected without mutation', () => {
 const rows=fixture(),original=structuredClone(rows)
 assert.throws(()=>decodeArchive({rows:rows.slice(0,3)}))
 assert.throws(()=>decodeArchive({format:'typewords-archive',version:9,rows}))
 const future=structuredClone(rows);future[2].data_version=4;assert.throws(()=>decodeArchive({rows:future}))
 const broken=structuredClone(rows);broken[2].data.entries['["library-keep-id","unit-1","study"]'].data.taskWordsStr.new=null
 assert.throws(()=>decodeArchive({rows:broken}))
 assert.deepEqual(rows,original)
 const wrongScope=structuredClone(rows);wrongScope[2].data.entries.wrong=Object.values(wrongScope[2].data.entries)[0]
 assert.throws(()=>decodeArchive({rows:wrongScope}),/标识/)
})
test('audio validation and content fingerprints include actual attachment bytes',async()=>{
 const rows=fixture();rows[0].data.article.bookList.push({id:'article',words:[],articles:[{audioFileId:'voice'}],statistics:[]})
 assert.throws(()=>validateAttachments(rows,[]),/缺少/)
 const a=[{id:'voice',file:new Blob(['one'])}],b=[{id:'voice',file:new Blob(['two'])}]
 validateAttachments(rows,a)
 assert.notEqual(await historyFingerprint(rows,a),await historyFingerprint(rows,b))
 const next=structuredClone(rows);next[2].data.entries['["library-keep-id","unit-1","study"]'].updatedAt='2099-01-01'
 assert.equal(await historyFingerprint(rows,a),await historyFingerprint(next,a))
})
test('Shanghai midnight and effective-date quotas are independent of device timezone and idle days',()=>{
 assert.equal(historyDate(new Date('2026-09-22T15:59:59Z')),'2026-09-22')
 assert.equal(historyDate(new Date('2026-09-22T16:00:00Z')),'2026-09-23')
 const days=['2026-01-01','2026-02-01','2026-08-01','2026-09-22'].map(day=>({day}))
 assert.deepEqual(retainDates(days,3).map(p=>p.day),days.slice(1).map(p=>p.day))
})
