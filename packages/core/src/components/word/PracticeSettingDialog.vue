<script setup lang="ts">
import { _getAccomplishDays } from '../../utils'
import { getBookLearning, normalizeLearningWord } from '../../utils/bookLearning'
import { BaseButton, InputNumber, Radio, RadioGroup, Slider, Tooltip, Toast } from '@typewords/base'
import { defineAsyncComponent, watch } from 'vue'
import { useSettingStore } from '../../stores/setting'
import { useBaseStore } from '../../stores/base'
import { usePracticeWordPersistence } from '../../composables/usePracticePersistence'
import ChangeLastPracticeIndexDialog from './ChangeLastPracticeIndexDialog.vue'
import { useRuntimeStore } from '../../stores/runtime'
import { BaseInput } from '@typewords/base'

const Dialog = defineAsyncComponent(() => import('@typewords/base/Dialog'))

const wordPersistence = usePracticeWordPersistence()
const settings = useSettingStore()
const runtimeStore = useRuntimeStore()

const model = defineModel()

const props = defineProps<{
  showLeftOption: boolean
  onConfirm?: () => Promise<void | boolean>
}>()

const emit = defineEmits<{
  ok: []
}>()

let show = $ref(false)
let tempPerDayStudyNumber = $ref(0)
let tempWordReviewRatio = $ref(0)
let tempLastLearnIndex = $ref(0)
let tempDuplicateMode = $ref<'off' | 'manual' | 'auto'>('manual')
let recoverSkippedWords = $ref(false)

const skippedWordCount = $computed(() => runtimeStore.editDict.learning?.skippedWords?.length ?? 0)

function prepareSkippedWordsRecovery() {
  const skippedWords = new Set(runtimeStore.editDict.learning?.skippedWords ?? [])
  const firstSkippedIndex = runtimeStore.editDict.words.findIndex(word => skippedWords.has(normalizeLearningWord(word.word)))
  if (firstSkippedIndex < 0) return

  recoverSkippedWords = true
  tempLastLearnIndex = Math.min(tempLastLearnIndex, firstSkippedIndex)
  tempDuplicateMode = 'manual'
}

async function changePerDayStudyNumber() {
  runtimeStore.editDict.perDayStudyNumber = Number(tempPerDayStudyNumber)
  runtimeStore.editDict.lastLearnIndex = Number(tempLastLearnIndex)
  runtimeStore.editDict.complete = runtimeStore.editDict.lastLearnIndex >= runtimeStore.editDict.length
  const learning = getBookLearning(runtimeStore.editDict)
  learning.duplicateMode = tempDuplicateMode
  if (recoverSkippedWords) learning.skippedWords = []
  learning.reviewRatio = tempWordReviewRatio
  const savedDict = useBaseStore().word.bookList.find(book => String(book.id) === String(runtimeStore.editDict.id))
  if (savedDict && savedDict !== runtimeStore.editDict) {
    if (savedDict.library) savedDict.perDayStudyNumber = runtimeStore.editDict.perDayStudyNumber
    const savedLearning = getBookLearning(savedDict)
    savedLearning.duplicateMode = tempDuplicateMode
    savedLearning.reviewRatio = tempWordReviewRatio
    if (recoverSkippedWords) savedLearning.skippedWords = []
  }
  if (recoverSkippedWords) await wordPersistence.clear(String(runtimeStore.editDict.id))
  return props?.onConfirm?.()
}

watch(
  () => model.value,
  n => {
    if (n) {
      if (runtimeStore.editDict.id) {
        tempPerDayStudyNumber = runtimeStore.editDict.perDayStudyNumber
        tempLastLearnIndex = runtimeStore.editDict.lastLearnIndex
        if (tempLastLearnIndex >= runtimeStore.editDict.length) tempLastLearnIndex = runtimeStore.editDict.length
        tempWordReviewRatio = getBookLearning(runtimeStore.editDict).reviewRatio ?? settings.wordReviewRatio
        tempDuplicateMode = runtimeStore.editDict.learning?.duplicateMode ?? 'manual'
        recoverSkippedWords = false
      } else {
        Toast.warning($t('please_select_dict'))
      }
    }
  }
)
</script>

<template>
  <Dialog
    v-model="model"
    :title="$t('learning_settings')"
    padding
    :footer="true"
    :onConfirm="changePerDayStudyNumber"
    @ok="emit('ok')"
  >
    <div class="target-modal color-main" id="mode">
      <div class="text-center mt-4">
        <span
          >{{ $t('total') }}<span class="target-number mx-2">{{ runtimeStore.editDict.length }}</span
          >{{ $t('words_count') }}，</span
        >
        <span
          >{{ $t('estimated')
          }}<span class="target-number mx-2">{{
            _getAccomplishDays(runtimeStore.editDict.length - tempLastLearnIndex, tempPerDayStudyNumber)
          }}</span
          >{{ $t('days_to_complete') }}</span
        >
      </div>

      <div class="text-center mt-4 mb-8 flex gap-1 items-end justify-center">
        <span v-if="!runtimeStore.editDict.library">{{ $t('from_word') }}</span>
        <div v-if="!runtimeStore.editDict.library" class="w-20">
          <BaseInput class="target-number" v-model="tempLastLearnIndex" />
        </div>
        <span>{{ runtimeStore.editDict.library ? '每轮学习' : $t('start_daily') }}</span>
        <div class="w-16">
          <BaseInput class="target-number" v-model="tempPerDayStudyNumber" />
        </div>
        <span>{{ $t('new_words_count2') }}</span>
        <span>，最多复习</span>
        <div class="target-number mx-2">
          {{ tempPerDayStudyNumber * tempWordReviewRatio || '-' }}
        </div>
        <span>{{ $t('words') }}</span>
      </div>

      <div class="mb-4 space-y-2">
        <div class="flex items-center gap-space">
          <Tooltip :title="$t('review_ratio_tooltip')">
            <div class="flex items-center gap-1 w-20 break-keep">
              <span>{{ $t('review_ratio') }}</span>
              <IconFluentQuestionCircle20Regular />
            </div>
          </Tooltip>
          <InputNumber :min="0" :max="10" v-model="tempWordReviewRatio" />
        </div>
        <div class="flex" v-if="!tempWordReviewRatio">
          <div class="w-23 flex-shrink-0"></div>
          <div class="text-sm text-gray-500">
            <div>{{ $t('review_ratio_notice_1') }}</div>
            <div>{{ $t('review_ratio_notice_2') }}</div>
          </div>
        </div>
      </div>

      <div class="flex mb-4 gap-space">
        <span class="shrink-0 w-20">{{ $t('daily_learning') }}</span>
        <Slider show-text class="mt-1" :max="500" v-model="tempPerDayStudyNumber" />
      </div>
      <div v-if="!runtimeStore.editDict.library" class="flex gap-space">
        <span class="shrink-0 w-20">{{ $t('learning_progress') }}</span>
        <div class="flex-1">
          <Slider
            :min="0"
            :step="10"
            show-text
            class="my-1"
            :max="runtimeStore.editDict.words.length"
            v-model="tempLastLearnIndex"
          />
          <BaseButton @click="show = true">{{ $t('select_from_dict') }}</BaseButton>
        </div>
      </div>
      <div class="mt-6">
        <div class="mb-2 font-medium">重复单词</div>
        <div class="text-sm text-gray-500 mb-2">遇到其他词书已学会的同一单词时的处理方式</div>
        <RadioGroup v-model="tempDuplicateMode">
          <Radio value="off" size="default">照常学习</Radio>
          <Radio value="manual" size="default">手动跳过（空格）</Radio>
          <Radio value="auto" size="default">自动跳过</Radio>
        </RadioGroup>
        <div class="mt-3 flex items-center gap-3">
          <span class="text-sm text-gray-500">已跳过 {{ skippedWordCount }} 个单词</span>
          <BaseButton size="small" :disabled="!skippedWordCount" @click="prepareSkippedWordsRecovery"
            >恢复跳过词</BaseButton
          >
        </div>
        <div v-if="recoverSkippedWords" class="mt-2 text-sm text-orange-500">
          将从最早跳过的位置重新学习，后续词可能重复出现。
        </div>
      </div>
    </div>
  </Dialog>
  <ChangeLastPracticeIndexDialog
    v-model="show"
    @ok="
      e => {
        tempLastLearnIndex = e
        show = false
      }
    "
  />
</template>

<style scoped lang="scss">
.target-modal {
  width: 35rem;

  .mode-item {
    @apply w-50% border border-blue border-solid p-2 rounded-lg cursor-pointer;
  }

  .active {
    @apply bg-blue color-white;
  }
}

// 移动端适配
@media (max-width: 768px) {
  .target-modal {
    width: 90vw !important;
    max-width: 400px;
    padding: 0 1rem;

    // 模式选择
    .center .flex.gap-4 {
      width: 100%;
      flex-direction: column;
      height: auto;
      gap: 0.8rem;

      .mode-item {
        width: 100%;
        padding: 1rem;

        .title {
          font-size: 1rem;
        }

        .desc {
          font-size: 0.85rem;
          margin-top: 0.5rem;
        }
      }
    }

    // 统计显示
    .text-center {
      font-size: 0.9rem;

      .text-3xl {
        font-size: 1.5rem;
      }
    }

    // 滑块控件
    .flex.mb-4,
    .flex.mb-6 {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;

      span {
        width: 100%;
      }

      .flex-1 {
        width: 100%;
      }
    }

    // 按钮
    .base-button {
      width: 100%;
      min-height: 44px;
    }
  }
}

@media (max-width: 480px) {
  .target-modal {
    width: 95vw !important;
    padding: 0 0.5rem;

    .text-center {
      font-size: 0.8rem;

      .text-3xl {
        font-size: 1.2rem;
      }
    }
  }
}
</style>
