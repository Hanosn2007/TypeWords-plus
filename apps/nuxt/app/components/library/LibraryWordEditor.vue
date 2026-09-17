<script setup lang="ts">
import type { Word } from '@typewords/core/types/types.ts'

// The parent owns this detached draft. No learning or personal-note store is used.
const word = defineModel<Word>({ required: true })
const splitWords = (value: string) => value ? value.split(/\r?\n/) : []
</script>

<template>
  <div class="word-fields">
    <div class="columns">
      <label>单词 / 词条 <input v-model="word.word" autocomplete="off" spellcheck="false" /></label>
      <label>音标① <input v-model="word.phonetic0" /></label>
      <label>音标② <input v-model="word.phonetic1" /></label>
    </div>
    <p class="hint">修改拼写会改变学习时使用的词身份；已有单元中的该词会一起改名，旧拼写的个人学习记录仍保留。</p>

    <section>
      <h3>释义 <button type="button" @click="word.trans.push({ pos: '', cn: '' })">＋ 添加释义</button></h3>
      <div v-for="(translation, index) in word.trans" :key="index" class="translation-row">
        <label>词性 <input v-model="translation.pos" placeholder="n. / v." /></label>
        <label>释义 <textarea v-model="translation.cn" rows="2" /></label>
        <button type="button" class="remove" :aria-label="`删除第 ${index + 1} 条释义`" @click="word.trans.splice(index, 1)">删除</button>
      </div>
      <p v-if="!word.trans.length" class="hint">暂无释义。可以保存草稿，发布前需要补全。</p>
    </section>

    <section v-for="field in (['sentences', 'phrases'] as const)" :key="field">
      <h3>{{ field === 'sentences' ? '例句' : '短语' }} <button type="button" @click="word[field].push({ c: '', cn: '' })">＋ 添加</button></h3>
      <div v-for="(pair, index) in word[field]" :key="index" class="pair-row">
        <label>原文 <textarea v-model="pair.c" rows="2" /></label>
        <label>中文 <textarea v-model="pair.cn" rows="2" /></label>
        <button type="button" class="remove" :aria-label="`删除第 ${index + 1} 条${field === 'sentences' ? '例句' : '短语'}`" @click="word[field].splice(index, 1)">删除</button>
      </div>
    </section>

    <details>
      <summary>更多词汇资料：近义词、同根词、词源</summary>
      <section>
        <h3>近义词 <button type="button" @click="word.synos.push({ pos: '', cn: '', ws: [] })">＋ 添加词组</button></h3>
        <div v-for="(group, index) in word.synos" :key="index" class="group">
          <div class="pair-row"><label>词性 <input v-model="group.pos" /></label><label>释义 <input v-model="group.cn" /></label><button type="button" class="remove" @click="word.synos.splice(index, 1)">删除</button></div>
          <label>近义词（每行一个）<textarea :value="group.ws.join('\n')" rows="3" @input="group.ws = splitWords(($event.target as HTMLTextAreaElement).value)" /></label>
        </div>
      </section>
      <section>
        <h3>同根词 <button type="button" @click="word.relWords.rels.push({ pos: '', words: [] })">＋ 添加词性分组</button></h3>
        <label>词根 <input v-model="word.relWords.root" /></label>
        <div v-for="(group, index) in word.relWords.rels" :key="index" class="group">
          <div class="group-heading"><label>词性 <input v-model="group.pos" /></label><button type="button" @click="group.words.push({ c: '', cn: '' })">＋ 添加同根词</button><button type="button" class="remove" @click="word.relWords.rels.splice(index, 1)">删除分组</button></div>
          <div v-for="(pair, pairIndex) in group.words" :key="pairIndex" class="pair-row">
            <label>词条 <input v-model="pair.c" /></label><label>释义 <input v-model="pair.cn" /></label><button type="button" class="remove" @click="group.words.splice(pairIndex, 1)">删除</button>
          </div>
        </div>
      </section>
      <section>
        <h3>词源 <button type="button" @click="word.etymology.push({ t: '', d: '' })">＋ 添加词源</button></h3>
        <div v-for="(item, index) in word.etymology" :key="index" class="pair-row">
          <label>标题 <input v-model="item.t" /></label><label>说明 <textarea v-model="item.d" rows="3" /></label><button type="button" class="remove" @click="word.etymology.splice(index, 1)">删除</button>
        </div>
      </section>
    </details>
  </div>
</template>

<style scoped>
.word-fields{display:grid;gap:18px}label{display:grid;gap:6px;font-size:13px;min-width:0}input,textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid #8886;border-radius:7px;padding:9px 10px;background:transparent;color:inherit;font:inherit}textarea{resize:vertical;line-height:1.6}button{border:1px solid #8885;border-radius:6px;padding:6px 10px;color:inherit;background:transparent;cursor:pointer;font-size:12px}button:disabled{opacity:.45;cursor:wait}.columns{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px}.hint{font-size:12px;opacity:.7;line-height:1.6}.translation-row{display:grid;grid-template-columns:90px 1fr auto;gap:10px;align-items:end;margin-top:12px}.pair-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-top:12px}h3{font-size:14px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:12px}.remove{color:#d05b51;align-self:end}.group{border:1px solid #8883;padding:14px;border-radius:8px;margin-top:12px}.group>label{margin-top:12px}.group-heading{display:flex;gap:10px;align-items:end;flex-wrap:wrap}details{border-top:1px solid #8883;padding-top:18px}summary{cursor:pointer;font-size:13px}details section{margin-top:22px}@media(max-width:650px){.columns{grid-template-columns:1fr}.pair-row{grid-template-columns:1fr}.translation-row{grid-template-columns:70px 1fr}.translation-row>.remove{grid-column:2;justify-self:end}.pair-row>.remove{justify-self:end}}
</style>
