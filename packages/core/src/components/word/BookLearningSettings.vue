<script setup lang="ts">
import { hasVisibleBookUnits } from '../../utils/libraryContent'
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import type { Dict, DuplicateMode, NewWordMode } from '../../types'
import { ShortcutKey, WordPracticeMode, WordPracticeStage } from '../../types'
import { useBaseStore, useSettingStore } from '../../stores'
import { getBookLearning, getBookTaskSettings, getNewWordLimit, selectUnitTaskWords } from '../../utils/bookLearning'
import { useDataSyncPersistence } from '../../composables/useDataSyncPersistence'
import { usePracticeWordPersistence } from '../../composables/usePracticePersistence'
import { bookPracticeSettingsKey } from '../../composables/bookPracticeSettings'
import { getCachedTaskWords, hasPracticeAnswerProgress, shouldRebuildPracticeForSettings } from '../../utils/practiceSettings'
import { WordPracticeModeStageMap } from '../../config/env'
import { Dialog, Toast } from '@typewords/base'

const props = defineProps<{ dict?: Dict }>()
const emit = defineEmits<{ saved: []; cancelled: [] }>()
const store = useBaseStore()
const settings = useSettingStore()
const persistence = useDataSyncPersistence()
const wordPersistence = usePracticeWordPersistence()
const practiceContext = inject(bookPracticeSettingsKey, undefined)
const target = computed(() => props.dict
  ? store.word.bookList.find(book => String(book.id) === String(props.dict.id)) ?? props.dict
  : store.sdict)
const duplicateMode = ref<DuplicateMode>('manual')
const newWordMode = ref<NewWordMode>('unit')
const hasUnits = computed(() => hasVisibleBookUnits(target.value))
const selectedUnit = computed(() => target.value.units?.find(unit => unit.id === getBookLearning(target.value).selectedUnitId))
const perDay = ref(20)
const reviewRatio = ref(1)
const saving = ref(false)
const showRestartConfirmation = ref(false)
let resolveRestartConfirmation: ((confirmed: boolean) => void) | undefined

function finishRestartConfirmation(confirmed: boolean) {
  showRestartConfirmation.value = false
  resolveRestartConfirmation?.(confirmed)
  resolveRestartConfirmation = undefined
}

onBeforeUnmount(() => finishRestartConfirmation(false))
const shortcutLabel = computed(() => {
  const key = settings.shortcutKeyMap[ShortcutKey.SkipLearnedWord]
  return key === 'Space' ? '空格' : key || '未设置'
})
const modes: { value: DuplicateMode; label: string; description: string }[] = [
  { value: 'off', label: '照常学习', description: '不显示跨词书提示，重复词也正常练习。' },
  { value: 'manual', label: '提示后手动跳过', description: '显示在哪本词书学过，由你决定再背一次或跳过。' },
  { value: 'auto', label: '自动跳过已掌握词', description: '只跳过其他词书明确标为“已掌握”的词，普通学过的词仍保留。' },
]

watch(() => target.value.id, () => {
  if (!target.value.id) return
  const learning = getBookLearning(target.value)
  duplicateMode.value = learning.duplicateMode
  newWordMode.value = learning.newWordMode ?? 'unit'
  perDay.value = target.value.perDayStudyNumber
  reviewRatio.value = learning.reviewRatio ?? settings.wordReviewRatio
}, { immediate: true })

async function save() {
  if (saving.value || !target.value.id) return
  if (!Number.isInteger(Number(perDay.value)) || Number(perDay.value) < 1 || Number(perDay.value) > 500 ||
    !Number.isFinite(Number(reviewRatio.value)) || Number(reviewRatio.value) < 0 || Number(reviewRatio.value) > 10) {
    Toast.warning('每轮新词请输入 1–500 的整数，复习比例请输入 0–10。')
    return
  }
  saving.value = true
  try {
    const book = target.value
    const dictId = String(book.id)
    const learning = getBookLearning(book)
    const nextValues = {
      duplicateMode: duplicateMode.value,
      newWordMode: hasUnits.value ? newWordMode.value : learning.newWordMode,
      reviewRatio: Number(reviewRatio.value),
    }
    const nextPerDay = Math.min(Number(perDay.value), book.length || 500)
    const proposedBook = { ...book, perDayStudyNumber: nextPerDay, learning: { ...learning, ...nextValues } }
    const currentTaskSettings = getBookTaskSettings(book, settings.wordReviewRatio)
    const nextTaskSettings = getBookTaskSettings(proposedBook, settings.wordReviewRatio)
    const context = practiceContext?.dictId() === dictId ? practiceContext : undefined
    const snapshot = context
      ? await context.snapshot()
      : { cache: await wordPersistence.getLocalEntryCompact(dictId), completed: false, hasUnsavedAnswer: false }
    const cachedTask = getCachedTaskWords(snapshot.cache)
    const completed = snapshot.completed || snapshot.cache?.statStoreData?.stage === WordPracticeStage.Complete
    // Old releases could retain a 20-word task after saving follow-unit mode.
    const ignored = settings.ignoreSimpleWord ? store.allIgnoreWordsSet : store.knownWordsSet
    const expectedLegacyNewCount = cachedTask && !cachedTask.settings && nextTaskSettings.newWordMode === 'unit'
      ? selectUnitTaskWords(proposedBook, getNewWordLimit(proposedBook), ignored).new.length
      : undefined
    const rebuild = shouldRebuildPracticeForSettings(currentTaskSettings, nextTaskSettings, snapshot.cache,
      learning.duplicateMode !== nextValues.duplicateMode, expectedLegacyNewCount)

    const mode = snapshot.cache?.practiceMode ?? learning.practiceMode ?? settings.wordPracticeMode
    let firstStage = WordPracticeModeStageMap[mode]?.[0]
    if (!cachedTask?.new.length) {
      if (mode === WordPracticeMode.System || mode === WordPracticeMode.IdentifyOnly) firstStage = WordPracticeStage.IdentifyReview
      if (mode === WordPracticeMode.DictationOnly) firstStage = WordPracticeStage.DictationReview
      if (mode === WordPracticeMode.ListenOnly) firstStage = WordPracticeStage.ListenReview
    }
    if (rebuild && !completed && (snapshot.hasUnsavedAnswer || hasPracticeAnswerProgress(snapshot.cache, firstStage))) {
      const confirmed = await new Promise<boolean>(resolve => {
        resolveRestartConfirmation = resolve
        showRestartConfirmation.value = true
      })
      if (!confirmed) {
        emit('cancelled')
        return
      }
    }
    if (String(target.value.id) !== dictId) return
    if (target.value !== book || getBookLearning(book) !== learning) {
      throw new Error('词书数据已更新，请重新保存设置。')
    }

    const saveSettings = async () => {
      const currentLearning = getBookLearning(book)
      const previous = { duplicateMode: currentLearning.duplicateMode, newWordMode: currentLearning.newWordMode, reviewRatio: currentLearning.reviewRatio }
      const previousPerDay = book.perDayStudyNumber
      Object.assign(currentLearning, nextValues)
      book.perDayStudyNumber = nextPerDay
      try {
        await persistence.saveDictState(store.$state, { pullWhenRemoteNewer: false })
      } catch (error) {
        Object.assign(currentLearning, previous)
        book.perDayStudyNumber = previousPerDay
        throw error
      }
    }
    if (context) {
      await context.apply(saveSettings, rebuild)
    } else {
      await saveSettings()
      if (rebuild && snapshot.cache) await wordPersistence.clear(dictId)
    }
    Toast.success('当前词书设置已保存')
    emit('saved')
  } catch (error) {
    console.warn('词书设置保存失败', error)
    Toast.error(error instanceof Error ? error.message : '保存失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form v-if="target.id" class="book-learning-settings" @submit.prevent="save">
    <div>
      <div class="book-name">{{ target.name }}</div>
      <p class="muted">只设置这本词书；其他词书保持各自的安排。</p>
    </div>
    <fieldset :disabled="saving">
      <legend>遇到其他词书学过的词</legend>
      <label v-for="mode in modes" :key="mode.value" class="mode-option" :class="{ selected: duplicateMode === mode.value }">
        <input v-model="duplicateMode" type="radio" name="book-duplicate-mode" :value="mode.value" />
        <span><strong>{{ mode.label }}</strong><span class="muted description">{{ mode.description }}</span></span>
      </label>
    </fieldset>
    <p class="muted">手动跳过快捷键：{{ shortcutLabel }}。可在设置页的快捷键设置中修改。</p>
    <fieldset v-if="hasUnits" :disabled="saving">
      <legend>每轮新词</legend>
      <label class="mode-option" :class="{ selected: newWordMode === 'unit' }">
        <input v-model="newWordMode" type="radio" name="book-new-word-mode" value="unit" />
        <span><strong>跟随单元</strong><span class="muted description">学完所选单元剩余的新词，数量随单元自动调整。</span></span>
      </label>
      <label class="mode-option" :class="{ selected: newWordMode === 'custom' }">
        <input v-model="newWordMode" type="radio" name="book-new-word-mode" value="custom" />
        <span><strong>自定义数量</strong><span class="muted description">按下方数量安排，单元剩余不足时不跨单元补齐。</span></span>
      </label>
      <p class="muted">当前选择：{{ selectedUnit?.name ?? '整本词书' }}。选择整本词书时始终使用下方自定义数量。</p>
    </fieldset>
    <div class="quantities">
      <label>{{ hasUnits ? '自定义数量' : '每轮新词' }}<input v-model.number="perDay" :disabled="saving" type="number" min="1" max="500" step="1" required /></label>
      <label>复习比例<input v-model.number="reviewRatio" :disabled="saving" type="number" min="0" max="10" step="1" required /></label>
    </div>
    <p v-if="hasUnits" class="muted">复习继续以自定义数量为基准安排；切换新词模式不改变复习量。</p>
    <p class="muted">保存后立即应用。若数量设置需要重新开始本轮，且已经作答，会先提醒你确认；只修改重复词策略会保留当前练习。</p>
    <button class="save-button" type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存词书设置' }}</button>
  </form>
  <p v-else>请先选择一本词书。</p>
  <Dialog v-if="showRestartConfirmation" title="重新开始本轮练习？" footer padding
    :close-on-click-bg="false" confirm-button-text="切换并重新开始" cancel-button-text="继续当前练习"
    @ok="finishRestartConfirmation(true)" @cancel="finishRestartConfirmation(false)" @close="finishRestartConfirmation(false)">
    <div class="restart-warning" role="alertdialog" aria-label="切换练习设置">
      <p>切换后，当前未完成的整轮练习会重新开始，包括本轮已经练过的阶段。</p>
      <p>已完成轮次的学习记录、复习记录和掌握状态会保留。若想保留本轮进度，可以先背完再切换。</p>
    </div>
  </Dialog>
</template>

<style scoped>
.book-learning-settings { display: flex; flex-direction: column; gap: 1rem; }
.book-name { font-size: 1.1rem; font-weight: 600; overflow-wrap: anywhere; }
.muted { font-size: .85rem; color: var(--color-font-2); line-height: 1.6; margin: .25rem 0 0; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
legend { font-weight: 600; margin-bottom: .6rem; }
.mode-option { display: flex; gap: .7rem; align-items: flex-start; padding: .8rem; border: 1px solid var(--color-line); border-radius: .6rem; margin-bottom: .5rem; cursor: pointer; }
.mode-option.selected { border-color: var(--btn-primary); background: var(--bg-card-secend); }
.mode-option input { margin-top: .3rem; accent-color: var(--btn-primary); }
.description { display: block; }
.quantities { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.quantities label { display: flex; flex-direction: column; gap: .4rem; }
.quantities input { min-width: 0; width: 100%; box-sizing: border-box; padding: .6rem; border: 1px solid var(--color-line); border-radius: .4rem; background: var(--bg-card-secend); color: inherit; }
.save-button { align-self: flex-end; border: 0; border-radius: .4rem; background: var(--btn-primary); color: white; padding: .65rem 1rem; cursor: pointer; }
.save-button:disabled { opacity: .6; cursor: wait; }
.restart-warning { width: min(26rem, calc(100vw - 5rem)); line-height: 1.7; }
</style>
