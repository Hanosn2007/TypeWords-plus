<script setup lang="ts">
import type { Word } from '../../types'
import { BaseButton } from '@typewords/base'
import { reactive, ref, watch } from 'vue'
import { useBaseStore } from '../../stores/base'
import { findOtherBookLearning, getBookLearning } from '../../utils/bookLearning'

type PaintMode = 'know' | 'unknown' | 'mastered' | 'skip'

const props = defineProps<{
  words: Word[]
}>()

export type WordMarkPickResult = {
  know: Word[]
  unknown: Word[]
  mastered: Word[]
  skipped: Word[]
}

const emit = defineEmits<{
  complete: [payload: WordMarkPickResult]
}>()

const paintMode = ref<PaintMode>('know')
const marks = reactive<Record<number, PaintMode>>({})
const store = useBaseStore()

const modeLabels: Record<PaintMode, string> = {
  know: '我认识',
  unknown: '不认识',
  mastered: '已掌握',
  skip: '跳过',
}

function getDuplicateSources(word: Word) {
  if (getBookLearning(store.sdict).duplicateMode === 'off') return []
  return findOtherBookLearning(store.word.bookList, store.sdict, word.word)
}

function duplicateSourceLabel(word: Word) {
  return getDuplicateSources(word)
    .map(source => `「${source.name}」${source.mastered ? '（已掌握）' : ''}`)
    .join('、')
}

function resetMarksForWords() {
  Object.keys(marks).forEach(key => delete marks[Number(key)])
  if (getBookLearning(store.sdict).duplicateMode !== 'auto') return

  props.words.forEach((word, index) => {
    if (getDuplicateSources(word).some(source => source.mastered)) marks[index] = 'skip'
  })
}

// Auto-mark only when this batch is initialized. A manual undo remains intact
// while the user works through the same stable words list.
watch(() => props.words, resetMarksForWords, { immediate: true })

/** 与当前顶部模式同色则取消标记，否则设为当前模式。 */
function onWordClick(index: number) {
  if (index < 0 || index >= props.words.length) return
  if (marks[index] === paintMode.value) {
    delete marks[index]
    return
  }
  marks[index] = paintMode.value
}

function toggleSkip(index: number) {
  if (index < 0 || index >= props.words.length) return
  if (marks[index] === 'skip') {
    delete marks[index]
    return
  }
  marks[index] = 'skip'
}

function rowClass(index: number) {
  const m = marks[index]
  if (!m) return 'mark-none'
  return {
    know: 'mark-know',
    unknown: 'mark-unknown',
    mastered: 'mark-mastered',
    skip: 'mark-skip',
  }[m]
}

function buildUnknownList(): Word[] {
  const usedKnow = props.words.some((_, i) => marks[i] === 'know')
  const usedMastered = props.words.some((_, i) => marks[i] === 'mastered')
  const usedUnknown = props.words.some((_, i) => marks[i] === 'unknown')

  const branchSimple = !usedUnknown && !(usedKnow && usedMastered)

  return props.words.filter((_, i) => {
    const m = marks[i]
    if (branchSimple) return m == null
    return m == null || m === 'unknown'
  })
}

function buildThreeLists(): WordMarkPickResult {
  return {
    know: props.words.filter((_, i) => marks[i] === 'know'),
    unknown: buildUnknownList(),
    mastered: props.words.filter((_, i) => marks[i] === 'mastered'),
    skipped: props.words.filter((_, i) => marks[i] === 'skip'),
  }
}

function onComplete() {
  emit('complete', buildThreeLists())
}
</script>

<template>
  <div class="word-mark-pick-list text-xl flex flex-col gap-3 w-full pt-10">
    <div class="flex flex-wrap gap-2 items-center">
      <div>标记分类:</div>
      <button
        v-for="mode in ['know', 'unknown', 'mastered'] as const"
        :key="mode"
        type="button"
        class="mode-btn"
        :class="{ active: paintMode === mode, [mode]: true }"
        @click="paintMode = mode"
      >
        {{ modeLabels[mode] }}
      </button>
    </div>
    <div>说明：点词标记，重复点击取消；切换分类继续标记。未标记与“不认识”将进入后续练习。</div>
    <div class="text-sm color-[var(--color-font-3)]">
      小提示：如果认识的多，建议切换为“不认识”进行标记；反之，切换为“我认识”进行标记
    </div>

    <div class="word-grid" role="list" aria-label="单词列表">
      <div
        v-for="(item, index) in words"
        :key="index"
        role="listitem"
        class="word-chip"
        :class="rowClass(index)"
        @click="onWordClick(index)"
      >
        <span class="word-text">{{ item.word }}</span>
        <div v-if="getDuplicateSources(item).length" class="duplicate-hint">
          <span>已在 {{ duplicateSourceLabel(item) }} 学过</span>
          <button type="button" class="duplicate-skip" @click.stop="toggleSkip(index)">
            {{ marks[index] === 'skip' ? '撤销跳过' : '跳过' }}
          </button>
        </div>
      </div>
    </div>

    <div class="center pt-1">
      <BaseButton type="primary" size="large" @click="onComplete">标记完成</BaseButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.word-mark-pick-list {
  max-height: calc(100vh - 12rem);
}

.mode-btn {
  padding: 0.35rem 0.85rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border, #37415155);
  background: var(--color-bg-soft, transparent);
  cursor: pointer;
  color: var(--color-main-text);
  @apply text-xl;
  &.active {
    font-weight: 600;
    border-color: var(--el-color-primary, #646cff);
  }
  &.know.active {
    background: rgba(34, 197, 94, 0.14);
    border-color: rgba(34, 197, 94, 0.35);
    color: #15803d;
  }
  &.unknown.active {
    background: rgba(239, 68, 68, 0.14);
    border-color: rgba(239, 68, 68, 0.35);
    color: #b91c1c;
  }
  &.mastered.active {
    background: rgba(59, 130, 246, 0.14);
    border-color: rgba(59, 130, 246, 0.35);
    color: #1d4ed8;
  }
}

.word-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  overflow: auto;
  align-content: flex-start;
  padding: 0.125rem;
  flex: 1;
  -webkit-overflow-scrolling: touch;
}

.word-chip {
  display: flex;
  align-items: flex-start;
  gap: 0.2rem;
  flex: 0 1 auto;
  max-width: 100%;
  padding: 0.3rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border, #37415133);
  cursor: pointer;
  user-select: none;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  line-height: 1.35;

  .word-text {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
}

.word-chip.mark-know {
  background: rgba(34, 197, 94, 0.14);
  border-color: rgba(34, 197, 94, 0.35);
  .word-text {
    color: #15803d;
  }
}
.word-chip.mark-unknown {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.35);
  .word-text {
    color: #b91c1c;
  }
}
.word-chip.mark-mastered {
  background: rgba(59, 130, 246, 0.14);
  border-color: rgba(59, 130, 246, 0.35);
  .word-text {
    color: #1d4ed8;
  }
}
.word-chip.mark-skip {
  background: rgba(107, 114, 128, 0.14);
  border-color: rgba(107, 114, 128, 0.4);
  .word-text {
    color: #6b7280;
    text-decoration: line-through;
  }
}
.word-chip.mark-none {
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.04));
  &:hover {
    background: rgba(128, 128, 128, 0.1);
    border-color: rgba(128, 128, 128, 0.25);
  }
}

.duplicate-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  color: var(--color-font-3, #6b7280);
}

.duplicate-skip {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-decoration: underline;
}
</style>
