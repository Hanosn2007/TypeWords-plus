<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Dict } from '../../types'
import { getUnitWords, normalizeLearningWord } from '../../utils/bookLearning'
const props = defineProps<{ book: Dict }>()
const open = ref(false)
const unitId = ref('')
const query = ref('')
const page = ref(0)
const filtered = computed(() => getUnitWords(props.book, unitId.value).filter(word => word.word.toLowerCase().includes(query.value.trim().toLowerCase())))
const shown = computed(() => filtered.value.slice(page.value * 50, (page.value + 1) * 50))
function show() { unitId.value = props.book.learning?.selectedUnitId ?? ''; page.value = 0; query.value = ''; open.value = true }
function status(word: string) {
  const key = normalizeLearningWord(word), learning = props.book.learning
  if (learning?.masteredWords.includes(key)) return '已掌握'
  if (learning?.skippedWords.includes(key)) return '已跳过'
  if (learning?.learnedWords.includes(key)) return '已学'
  return '未学'
}
</script>
<template>
  <button class="unit-browse-button" @click="show">单元词表</button>
  <Teleport to="body">
    <div v-if="open" class="unit-browser-backdrop" @click.self="open = false" @keydown.esc="open = false">
      <section class="unit-browser card" role="dialog" aria-modal="true" aria-label="单元词表">
        <header><h2>{{ book.name }} · 单元词表</h2><button aria-label="关闭单元词表" @click="open = false">关闭</button></header>
        <p>查看词表不会改变学习单元或未完成练习。</p>
        <div class="controls">
          <select v-model="unitId" aria-label="查看单元" @change="page = 0">
            <option value="">整本词书</option><option v-for="unit in book.units" :key="unit.id" :value="unit.id">{{ unit.name }} · {{ unit.words.length }}词</option>
          </select>
          <input v-model="query" aria-label="搜索单元单词" placeholder="搜索单词" @input="page = 0" />
          <span>{{ filtered.length }}词</span>
        </div>
        <div class="word-rows">
          <article v-for="word in shown" :key="word.word">
            <div><strong>{{ word.word }}</strong><small>{{ status(word.word) }}</small></div>
            <p>{{ word.trans?.map(item => `${item.pos ?? ''} ${item.cn ?? ''}`).join('；') || '暂无释义' }}</p>
          </article>
          <p v-if="!shown.length">当前范围没有匹配的单词。</p>
        </div>
        <footer><button :disabled="page === 0" @click="page--">上一页</button><span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(filtered.length / 50)) }}</span><button :disabled="(page + 1) * 50 >= filtered.length" @click="page++">下一页</button></footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.unit-browse-button,button,select,input{padding:.5rem .8rem;border:1px solid var(--color-line,#777);border-radius:.4rem;color:inherit;background:var(--bg-card-secend,#303236)}
.unit-browser-backdrop{position:fixed;inset:0;background:#0008;z-index:9500;display:grid;place-items:center;padding:1rem}
.unit-browser{background:var(--bg-card,#27292c);color:var(--color-font,#ddd);width:min(48rem,100%);max-height:88vh;display:flex;flex-direction:column;padding:1.3rem;gap:1rem}
header,.controls,footer{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h2{font-size:1.15rem}.word-rows{overflow:auto;min-height:0}.word-rows article{border-bottom:1px solid var(--color-line,#555);padding:.8rem 0}.word-rows small{margin-left:1rem;opacity:.65}.word-rows p{margin-top:.35rem;line-height:1.6}footer{justify-content:center}button:disabled{opacity:.4}
</style>
