import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../../../apps/nuxt/app/pages/(words)/words.vue',import.meta.url),'utf8')
const text=source.slice(source.indexOf('async function freePractice()'),source.indexOf('\nfunction systemPractice()'))
const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
test('opening free practice never clears or rewrites the unfinished formal task',async()=>{
  let navigation
  const formal={taskWords:{new:[{word:'formal'}],review:[]},practiceData:{index:7}}
  const deps={isApplyingBookSettings:false,isSwitchingBook:false,isChangingUnit:false,store:{sdict:{id:'book'}},settingStore:{},
    usePracticeWordPersistence:()=>({loadLocal:async()=>null,clear:()=>assert.fail('must not clear')}),getBookLearning:()=>({selectedUnitId:'two'}),
    createEmptyPracticeData:()=>({taskWords:{new:[],review:[]}}),getUnitWords:()=>[{word:'free'}],WordPracticeMode:{Free:1},WordPracticeModeUrlMap:{1:'/practice-words'},
    Toast:{warning:()=>assert.fail('unexpected empty range')},nav:(...args)=>{navigation=args},practiceData:formal,resetCacheData:()=>assert.fail('must not reset'),startPractice:()=>assert.fail('legacy start would clear formal cache')}
  const fn=new Function(...Object.keys(deps),js+';return freePractice')(...Object.values(deps))
  await fn();assert.equal(formal.practiceData.index,7)
  assert.equal(navigation[2].taskWords.unitId,'two');assert.equal(navigation[2].practiceMode,1)
})
