<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LibraryBookContent } from '@typewords/core/types/library.ts'
import { normalizeLearningWord } from '@typewords/core/utils/bookLearning.ts'

const props = defineProps<{ content: LibraryBookContent; label: string }>()
const query = ref('')
const unit = ref('')
const page = ref(1)
const members = computed(() => unit.value ? new Set(props.content.units.find(item => item.id === unit.value)?.words.map(normalizeLearningWord) ?? []) : null)
const filtered = computed(() => props.content.words.filter(word => {
  if (members.value && !members.value.has(normalizeLearningWord(word.word))) return false
  const needle = query.value.trim().toLowerCase()
  return !needle || word.word?.toLowerCase().includes(needle) || word.trans?.some(item => item.cn.toLowerCase().includes(needle))
}))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 50)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 50, page.value * 50))
watch([query, unit, () => props.content], () => { page.value = 1 })
watch(() => props.content, () => { query.value = ''; unit.value = '' })
</script>

<template>
  <section class="book-preview">
    <div class="preview-note">{{ label }} · 只读预览</div>
    <h2>{{ content.name || '未命名词书' }}</h2>
    <p class="description">{{ content.description || '暂无说明' }}</p>
    <p class="muted">{{ content.words.length }} 个词 · {{ content.units.length }} 个单元 · {{ content.category }}<span v-if="content.tags.length"> · {{ content.tags.join(' / ') }}</span></p>
    <div class="filters"><label>单元 <select v-model="unit"><option value="">整书</option><option v-for="item in content.units" :key="item.id" :value="item.id">{{ item.name }}（{{ item.words.length }}）</option></select></label><label>搜索词条或释义 <input v-model="query" type="search" placeholder="输入单词或释义" /></label></div>
    <p class="muted">匹配 {{ filtered.length }} 个词</p>
    <div class="cards">
      <article v-for="(word, index) in visible" :key="`${word.word}-${index}`" class="word-card">
        <h3>{{ word.word }}</h3><p v-if="word.phonetic0 || word.phonetic1" class="phonetics"><span v-if="word.phonetic0">① {{ word.phonetic0 }}</span><span v-if="word.phonetic1">② {{ word.phonetic1 }}</span></p>
        <p v-for="(item, i) in word.trans" :key="`trans-${i}`"><span class="muted">{{ item.pos }}</span> {{ item.cn }}</p>
        <p v-if="!word.trans?.length" class="muted">缺少释义</p>
        <section v-if="word.sentences?.length"><h4>例句</h4><div v-for="(item, i) in word.sentences" :key="i" class="pair"><p>{{ item.c }}</p><p class="muted">{{ item.cn }}</p></div></section>
        <section v-if="word.phrases?.length"><h4>短语</h4><div v-for="(item, i) in word.phrases" :key="i" class="pair"><p>{{ item.c }}</p><p class="muted">{{ item.cn }}</p></div></section>
        <section v-if="word.synos?.length"><h4>近义词</h4><p v-for="(item, i) in word.synos" :key="i">{{ item.pos }} {{ item.cn }}：{{ item.ws.join(' / ') }}</p></section>
        <section v-if="word.relWords?.root || word.relWords?.rels?.length"><h4>同根词 <span v-if="word.relWords?.root">· {{ word.relWords.root }}</span></h4><div v-for="(group, i) in word.relWords?.rels" :key="i"><p class="muted">{{ group.pos }}</p><p v-for="(item, j) in group.words" :key="j">{{ item.c }} {{ item.cn }}</p></div></section>
        <section v-if="word.etymology?.length"><h4>词源</h4><div v-for="(item, i) in word.etymology" :key="i"><p>{{ item.t }}</p><p class="muted">{{ item.d }}</p></div></section>
      </article>
    </div>
    <p v-if="!filtered.length" class="muted">没有匹配的词条。</p>
    <nav class="pagination" aria-label="预览分页"><button :disabled="page === 1" @click="page--">上一页</button><span>{{ page }} / {{ pages }}</span><button :disabled="page >= pages" @click="page++">下一页</button></nav>
  </section>
</template>

<style scoped>
.book-preview{line-height:1.65}.preview-note{font-size:12px;color:var(--color-select-bg,#3477dc);margin-bottom:10px}h2{font-size:26px;font-weight:650}h3{font-size:21px;font-weight:600;margin-bottom:8px}h4{font-size:13px;font-weight:600;margin-bottom:8px}.description{white-space:pre-wrap;margin:12px 0}.muted{opacity:.65;font-size:13px}.filters{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0 14px}.filters label{display:grid;gap:6px;min-width:180px;font-size:13px}input,select,button{border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;padding:8px 12px;font:inherit}select option{color:CanvasText;background:Canvas}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px;margin-top:18px;align-items:start}.word-card{border:1px solid #8884;border-radius:12px;padding:22px;overflow-wrap:anywhere}.word-card p{white-space:pre-wrap}.word-card section{border-top:1px solid #8882;margin-top:16px;padding-top:14px}.pair+.pair{margin-top:10px}.phonetics{display:flex;flex-wrap:wrap;gap:15px;opacity:.65;font-size:13px;margin-bottom:12px}.pagination{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:26px;font-size:13px}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}
</style>
