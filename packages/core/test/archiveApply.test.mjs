import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import * as db from 'idb-keyval'
import * as atomic from '../src/utils/atomicStorage.ts'
import * as policy from '../src/utils/syncPolicy.ts'
import * as archive from '../src/utils/dataArchive.ts'
import * as cache from '../src/utils/cache.ts'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

test('real replacement commits rows/files/marker together; quota and stale preview leave data and memory intact',async()=>{
 await db.clear()
 const initial={word:{studyIndex:0,bookList:[{id:'stable-book',name:'Book',custom:true,words:[{word:'apple'}],articles:[],statistics:[],learning:{fsrs:{apple:{reps:4,lapses:2,stability:12.25}},learnedWords:['apple'],masteredWords:[],skippedWords:[],selectedUnitId:'lesson-1'},units:[{id:'lesson-1',name:'Lesson 1',words:['apple']}]}]},article:{studyIndex:-1,bookList:[]},load:true}
 const store={$state:structuredClone(initial),setState(v){this.$state=v},get sdict(){return this.$state.word.bookList[0]},get sbook(){return undefined}}
 const settings={$state:{theme:'dark',load:true},setState(v){this.$state=v}}
 let hooks
 const deps={
  '../utils':{shakeCommonDict:structuredClone,checkAndUpgradeSaveDict:async r=>structuredClone(r.val),checkAndUpgradeSaveSetting:async r=>structuredClone(r.val),_getDictDataByUrl:async()=>({})},
  '../utils/cache':cache,'../config/env':{LOCAL_FILE_KEY:'typing-word-files'},'../stores':{useBaseStore:()=>store,useSettingStore:()=>settings},'../types':{DictType:{article:'article'},SyncDataType:{dict:'dict',setting:'setting',practice_word:'practice_word',practice_article:'practice_article'}},'idb-keyval':db,'../utils/atomicStorage':atomic,
  '../utils/cloudSync':{CloudSync:{check:()=>false}},'../utils/safeSync':{configureSafeSync:v=>hooks=v,serializeSyncLocalWrite:work=>work(),LOCAL_REPLACEMENT_KEY:'replacement-marker'},'../utils/syncPolicy':policy,'../utils/dataArchive':archive,
  '../utils/localHistory':{configureLocalHistory:()=>{},markHistoryDirty:()=>{},checkpointBeforeNewDate:async()=>{},HISTORY_DIRTY_KEY:'dirty'},vue:{toRaw:v=>v},
 }
 const js=ts.transpileModule(readFileSync(new URL('../src/composables/useDataSyncPersistence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const m={exports:{}};new Function('require','module','exports',js)(key=>{if(!(key in deps))throw Error(key);return deps[key]},m,m.exports)
 const api=m.exports.useDataSyncPersistence(), before=await api.readSafeSnapshot()
 await atomic.atomicSetMany(before.map(r=>[archive.DATA_KEYS[r.type],JSON.stringify({val:r.data,version:r.data_version})]))
 const desired=structuredClone(before);desired[0].data.word.bookList[0].learning.learnedWords=['apple','pear']
 desired[0].data.article.bookList.push({id:'audio-book',custom:true,words:[],statistics:[],articles:[{audioFileId:'voice',text:'Hello'}]})
 const files=[{id:'voice',file:new Blob(['sound'])}]
 const signature=policy.rowsSignature(before), persisted=await db.getMany(Object.values(archive.DATA_KEYS))
 const put=IDBObjectStore.prototype.put
 IDBObjectStore.prototype.put=function(value,key){if(key==='replacement-marker')throw new DOMException('quota injected','QuotaExceededError');return put.call(this,value,key)}
 try{await assert.rejects(hooks.apply(desired,signature,{files,replacement:true}),/quota/)}finally{IDBObjectStore.prototype.put=put}
 assert.deepEqual(await db.getMany(Object.values(archive.DATA_KEYS)),persisted)
 assert.deepEqual(store.$state,initial);assert.equal(await db.get('typing-word-files'),undefined)
 await assert.rejects(hooks.apply(desired,'stale',{files,replacement:true}),/变化/)
 await hooks.apply(desired,signature,{files,replacement:true})
 assert.equal(await db.get('replacement-marker'),true)
 assert.equal((await db.get('typing-word-files'))[0].id,'voice')
 assert.deepEqual(store.$state.word.bookList[0].learning.fsrs,initial.word.bookList[0].learning.fsrs)
 assert.equal(store.$state.word.bookList[0].learning.selectedUnitId,'lesson-1')
 assert.deepEqual(store.$state.word.bookList[0].learning.learnedWords,['apple','pear'])
})
