import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {upgradePracticeScopes,practiceScopeKey} from '../src/utils/cache.ts'
const source=readFileSync(new URL('../src/composables/studyUpgrade.ts',import.meta.url),'utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
test('upgrade waits for approval, failed transaction retains old task, retry commits backup and task together',async()=>{
  const raw=JSON.stringify({version:1,val:{schemaVersion:2,entries:{book:{data:{dictId:'book',taskWords:{unitId:'two',new:[{word:'cat'}],review:[]},practiceData:{index:1}},updatedAt:'2026-09-21'}}}})
  const db=new Map([['PracticeSaveWord',raw]])
  let fail=true,commits=0
  const deps={vue:{shallowRef:value=>({value})},'idb-keyval':{get:async key=>db.get(key),setMany:async entries=>{if(fail)throw new Error('disk full');for(const [key,value]of entries)db.set(key,value);commits++}},'../utils/cache':{PRACTICE_WORD_CACHE:{key:'PracticeSaveWord'},upgradePracticeScopes},'../config/env':{SAVE_DICT_KEY:{key:'dict'},SAVE_SETTING_KEY:{key:'setting'}}}
  const m={exports:{}}
  new Function('require','exports','module','localStorage',js)(name=>deps[name],m.exports,m,{getItem:()=>null})
  let resumed=false
  const waiting=m.exports.ensureStudyUpgrade().then(()=>{resumed=true})
  for(let i=0;i<10;i++)await Promise.resolve()
  assert.equal(m.exports.studyUpgrade.value.required,true);assert.equal(resumed,false)
  await m.exports.acceptStudyUpgrade()
  assert.equal(db.get('PracticeSaveWord'),raw);assert.equal(resumed,false);assert.match(m.exports.studyUpgrade.value.error,/disk full/)
  fail=false;await m.exports.acceptStudyUpgrade();await waiting
  assert.equal(commits,1);assert.equal(resumed,true)
  assert.equal(db.get('typewords-before-study-scopes-v3').entries.find(([key])=>key==='PracticeSaveWord')[1],raw)
  assert.equal(JSON.parse(db.get('PracticeSaveWord')).val.entries[practiceScopeKey('book','two')].data.practiceData.index,1)
  await m.exports.ensureStudyUpgrade();assert.equal(commits,1)
})
