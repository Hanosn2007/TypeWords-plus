<script setup lang="ts">
import UnitWordBrowser from './UnitWordBrowser.vue'
import { computed, ref, watch } from 'vue'
import { BaseButton, Toast } from '@typewords/base'
import { useBaseStore, useSettingStore } from '../../stores'
import { getDefaultWord } from '../../types/func'
import { useDataSyncPersistence } from '../../composables/useDataSyncPersistence'
import { usePracticeWordPersistence } from '../../composables/usePracticePersistence'
import {
  getBookLearning,
  getUnitProgress,
  isFollowingStudyUnit,
  migrateLegacyFsrsToBookLearning,
  normalizeLearningWord,
  refreshUnitBookProgress,
  seedUnitLearningFromLegacyProgress,
} from '../../utils/bookLearning'
import { createVocabulary6000Units, getVocabulary6000Repairs, matchesVocabulary6000 } from '../../utils/vocabulary6000'
import { hasVisibleBookUnits } from '../../utils/libraryContent'

const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ changed: []; review: []; busy: [value: boolean] }>()
const store = useBaseStore()
const setting = useSettingStore()
const persistence = useDataSyncPersistence()
const wordPersistence = usePracticeWordPersistence()
const busy = ref(false)
watch(busy, value => emit('busy', value), { flush: 'sync' })
const dict = computed(() => store.sdict)
const units = computed(() => hasVisibleBookUnits(dict.value) ? dict.value.units ?? [] : [])
const canEnable = computed(() => !dict.value.library && matchesVocabulary6000(dict.value))
const selected = computed(() => getBookLearning(dict.value).selectedUnitId ?? '')
const ignored = computed(() => setting.ignoreSimpleWord ? store.allIgnoreWordsSet : store.knownWordsSet)
const progress = computed(() => getUnitProgress(dict.value, selected.value, ignored.value))
const selectedIndex = computed(() => units.value.findIndex(unit => unit.id === selected.value))
const currentName = computed(() => units.value[selectedIndex.value]?.name ?? '整本词书')
const quantityHint = computed(() => isFollowingStudyUnit(dict.value)
  ? '跟随单元：安排当前单元全部剩余新词。'
  : `自定义数量：每轮最多 ${dict.value.perDayStudyNumber} 个新词${selected.value ? '，不跨单元补齐' : ''}。`)
const repairs = computed(() => getVocabulary6000Repairs(dict.value))

async function hasPendingPractice() {
  if (props.disabled || busy.value) return true
  const cache = await wordPersistence.loadLocal(String(dict.value.id))
  if (cache) {
    Toast.warning('请先继续并完成当前一轮，再切换学习单元。')
    return true
  }
  return false
}

async function enable() {
  if (await hasPendingPractice()) return
  if (!matchesVocabulary6000(dict.value)) return
  busy.value = true
  try {
    // Seed from the existing list before appending missing words, so old positions retain their meaning.
    migrateLegacyFsrsToBookLearning(dict.value, store.fsrsData)
    seedUnitLearningFromLegacyProgress(dict.value)
    getBookLearning(dict.value).legacyFsrsMigrated = true
    for (const source of getVocabulary6000Repairs(dict.value)) {
      const index = dict.value.words.findIndex(word => normalizeLearningWord(word.word) === normalizeLearningWord(source.word))
      const restored = getDefaultWord({ ...source, ...(index >= 0 ? { id: dict.value.words[index].id } : {}) })
      if (index >= 0) dict.value.words.splice(index, 1, restored)
      else dict.value.words.push(restored)
    }
    dict.value.length = dict.value.words.length
    dict.value.units = createVocabulary6000Units()
    const firstPending = units.value.find(unit => getUnitProgress(dict.value, unit.id, ignored.value).remaining > 0)
    getBookLearning(dict.value).selectedUnitId = firstPending?.id ?? units.value[0]?.id ?? ''
    refreshUnitBookProgress(dict.value, ignored.value)
    await persistence.saveDictState(store.$state, { pullWhenRemoteNewer: false })
    emit('changed')
    Toast.success('已按原书建立 31 个单元，原有学习记录已保留。')
  } catch (error) {
    console.error('启用单元学习失败', error)
    Toast.error('保存失败，请重试。')
  } finally {
    busy.value = false
  }
}

async function select(unitId: string) {
  if (props.disabled || busy.value) return
  if (unitId && !units.value.some(unit => unit.id === unitId)) return
  busy.value = true
  try {
    getBookLearning(dict.value).selectedUnitId = unitId
    await persistence.saveDictState(store.$state, { pullWhenRemoteNewer: false })
    emit('changed')
  } catch (error) {
    console.error('保存学习单元失败', error)
    Toast.error('保存失败，请重试。')
  } finally {
    busy.value = false
  }
}

async function onSelect(event: Event) {
  const element = event.target as HTMLSelectElement
  await select(element.value)
  element.value = selected.value
}
</script>

<template>
  <section v-if="canEnable || units.length" class="unit-panel card mb-4 p-4 md:p-5" aria-labelledby="book-unit-title">
    <template v-if="!units.length">
      <h2 id="book-unit-title" class="title mb-2">按原书单元学习</h2>
      <p class="unit-hint">识别到 Vocabulary 6000：31 个单元，每单元 40 词。启用后可直接选择 Lesson，原有学习记录保留。</p>
      <p v-if="repairs.length" class="unit-hint">将按原书补齐：{{ repairs.map(word => word.word).join('、') }}。</p>
      <BaseButton class="mt-3" type="primary" :disabled="disabled || busy" :loading="busy" @click="enable">
        启用 31 个单元
      </BaseButton>
    </template>
    <template v-else>
      <div class="unit-heading">
        <h2 id="book-unit-title" class="title mb-0">学习单元</h2>
        <UnitWordBrowser :book="dict" />
        <span class="unit-hint">{{ currentName }} · 已处理 {{ progress.handled }} / {{ progress.total }} 词</span>
      </div>
      <div class="unit-controls">
        <label for="study-unit">本次学习</label>
        <select id="study-unit" :value="selected" :disabled="disabled || busy" @change="onSelect">
          <option value="">整本词书</option>
          <option v-for="unit in units" :key="unit.id" :value="unit.id">
            {{ unit.name }} · {{ getUnitProgress(dict, unit.id, ignored).handled }}/{{ unit.words.length }}
          </option>
        </select>
        <BaseButton type="info" :disabled="disabled || busy || selectedIndex < 0 || selectedIndex >= units.length - 1" @click="select(units[selectedIndex + 1].id)">
          下一单元
        </BaseButton>
        <BaseButton v-if="selected" type="info" :disabled="disabled || busy || progress.remaining > 0" @click="emit('review')">重练本单元</BaseButton>
      </div>
      <p class="unit-hint">{{ progress.remaining ? `${selected ? '本单元' : '整本词书'}剩余 ${progress.remaining} 词。${quantityHint}` : '当前范围已处理完，可以重练或选择下一单元。' }} 到期复习仍来自本书已学词。</p>
      <p v-if="progress.skipped" class="unit-hint">其中跳过 {{ progress.skipped }} 词，跳过不表示已经掌握。</p>
    </template>
    <p class="unit-hint mt-2">每个单元分别保留未完成练习，切换后可继续原来的位置。</p>
  </section>
</template>

<style scoped>
.unit-heading, .unit-controls { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
.unit-heading { justify-content: space-between; margin-bottom: .85rem; }
.unit-controls { margin-bottom: .75rem; }
.unit-controls label { font-weight: 600; }
.unit-controls select { min-width: 12rem; padding: .6rem .8rem; border: 1px solid var(--color-line); border-radius: .45rem; background: var(--bg-card-secend); color: inherit; }
.unit-hint { font-size: .85rem; color: var(--color-font-2); line-height: 1.7; margin: .3rem 0 0; }
.unit-controls select:disabled { opacity: .6; }
@media (max-width: 640px) { .unit-controls select { flex: 1; } }
</style>
