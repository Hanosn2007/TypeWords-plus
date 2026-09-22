import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import * as idb from 'idb-keyval'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import * as policy from '../src/utils/historyPolicy.ts'
import * as sync from '../src/utils/syncPolicy.ts'
import * as archive from '../src/utils/dataArchive.ts'
import * as atomic from '../src/utils/atomicStorage.ts'

function load(file,deps) {
 const source=readFileSync(new URL(file,import.meta.url),'utf8')
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const module={exports:{}};new Function('require','module','exports',js)(key=>{if(key==='./atomicStorage.ts')return atomic;if(!(key in deps))throw Error(key);return deps[key]},module,module.exports);return module.exports
}
const rows=n=>[{type:'dict',data_version:4,data:{word:{studyIndex:0,bookList:[{id:'book',name:'Book',words:[],articles:[],statistics:[],lastLearnIndex:n}]},article:{studyIndex:-1,bookList:[]}}},{type:'setting',data_version:25,data:{theme:'dark'}},{type:'practice_word',data_version:3,data:{schemaVersion:3,entries:{}}},{type:'practice_article',data_version:1,data:null}]
test('daily local history survives reload, deletion does not resurrect, owners remain isolated',async()=>{
 await idb.clear();let current=rows(1)
 const setup=()=>{const api=load('../src/utils/localHistory.ts',{'idb-keyval':idb,'./historyPolicy.ts':policy,'./syncPolicy.ts':sync,'./dataArchive.ts':archive});api.configureLocalHistory(async()=>({rows:structuredClone(current),files:[]}));return api}
 let h=setup();await h.primeLocalHistory();current=rows(2);h.markHistoryDirty();await idb.set(h.HISTORY_DIRTY_KEY,new Date().toISOString());await h.checkpointLocalHistory()
 let list=await h.listLocalHistory();assert.equal(list.points.length,1);const first=list.points[0]
 current=rows(3);h.markHistoryDirty();await h.checkpointLocalHistory();list=await h.listLocalHistory();assert.equal(list.points[0].id,first.id)
 assert.equal((await h.readLocalHistory(first)).rows[0].data.word.bookList[0].lastLearnIndex,3)
 await h.deleteLocalHistory(first);h=setup();await h.checkpointLocalHistory();assert.ok((await h.listLocalHistory()).points[0].deletedAt)
 current=rows(4);h.markHistoryDirty();await h.checkpointLocalHistory();assert.equal((await h.listLocalHistory()).points.length,2)
 await assert.rejects(h.deleteLocalHistory(first,true),/当天已有/)
 await idb.set('typewords-sync-owner-v2',7);current=rows(5);h.markHistoryDirty();await h.checkpointLocalHistory()
 const owned=(await h.listLocalHistory()).points.find(p=>p.owner===7)
 await idb.set('typewords-sync-owner-v2',8);await assert.rejects(h.readLocalHistory(owned),/另一个账号/)
})

test('IndexedDB setMany failure aborts all rows and attachments, subsequent save succeeds',async()=>{
 await idb.clear();await idb.setMany([['dict','original'],['setting','old'],['audio',['original']]])
 const put=IDBObjectStore.prototype.put;let count=0
 IDBObjectStore.prototype.put=function(...args){if(++count===2)throw new DOMException('Injected quota','QuotaExceededError');return put.apply(this,args)}
 try {await assert.rejects(atomic.atomicSetMany([['dict','replacement'],['setting','new'],['audio',['new']]]))} finally {IDBObjectStore.prototype.put=put}
 assert.deepEqual(await idb.getMany(['dict','setting','audio']),['original','old',['original']])
 await idb.setMany([['dict','retry'],['setting','retry']]);assert.equal(await idb.get('dict'),'retry')
})

test('legacy sources are preserved, bad sources are exportable and scanned once',async()=>{
 await idb.clear();await idb.set('typewords-before-study-scopes-v3',{createdAt:new Date().toISOString(),entries:[['broken','bad']]})
 const h=load('../src/utils/localHistory.ts',{'idb-keyval':idb,'./historyPolicy.ts':policy,'./syncPolicy.ts':sync,'./dataArchive.ts':archive})
 const first=await h.listLocalHistory();assert.equal(first.errors.length,1)
 assert.equal((await h.listLocalHistory()).errors.length,1)
 assert.deepEqual(await h.readUnconvertedHistory(first.errors[0].id),await idb.get('typewords-before-study-scopes-v3'))
})
