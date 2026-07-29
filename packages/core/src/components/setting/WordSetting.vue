<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { InputNumber, Slider, Switch, Radio, RadioGroup } from '@typewords/base'
import SettingItem from './SettingItem.vue'
import { useSettingStore } from '../../stores/setting.ts'
import { IdentifyMethod, WholeInputSubmitMode, WordInputMode, WordInputStage } from '../../types'
import WordInputModeSegment from '../word/WordInputModeSegment.vue'

const settingStore = useSettingStore()
const inputModesExpanded = ref(false)
const expandedGroups = reactive<Record<string, boolean>>({
  new: false,
  review: false,
})
const stageGroups = [
  {
    key: 'new',
    title: '新词阶段',
    items: [
      { stage: WordInputStage.FollowWriteNewVisible, label: '跟写新词', detail: '显示单词' },
      { stage: WordInputStage.FollowWriteNewMasked, label: '跟写新词', detail: '遮罩拼写' },
      { stage: WordInputStage.ListenNew, label: '听写新词' },
      { stage: WordInputStage.DictationNew, label: '默写新词' },
    ],
  },
  {
    key: 'review',
    title: '复习阶段',
    items: [
      { stage: WordInputStage.FollowWriteReviewVisible, label: '跟写旧词', detail: '显示单词' },
      { stage: WordInputStage.FollowWriteReviewMasked, label: '跟写旧词', detail: '遮罩拼写' },
      { stage: WordInputStage.ListenReview, label: '听写旧词' },
      { stage: WordInputStage.DictationReview, label: '默写旧词' },
      { stage: WordInputStage.Shuffle, label: '随机复习' },
    ],
  },
]
const hasWholeInputStage = computed(() =>
  stageGroups.some(group =>
    group.items.some(item => settingStore.wordInputModeByStage[item.stage] === WordInputMode.Whole)
  )
)

function getStageInputMode(stage: WordInputStage) {
  return settingStore.wordInputModeByStage[stage] ?? settingStore.wordInputMode
}

function setStageInputMode(stage: WordInputStage, mode: WordInputMode) {
  settingStore.wordInputModeByStage = {
    ...settingStore.wordInputModeByStage,
    [stage]: mode,
  }
}
</script>

<template>
  <div>
    <SettingItem :title="$t('show_prev_next_word')" :desc="$t('show_prev_next_word_desc')">
      <Switch v-model="settingStore.showNearWord" />
    </SettingItem>

    <SettingItem :title="$t('clear_input_on_error')">
      <Switch v-model="settingStore.inputWrongClear" />
    </SettingItem>

    <div class="line"></div>
    <section class="input-mode-settings">
      <button class="accordion-heading" type="button" @click="inputModesExpanded = !inputModesExpanded">
        <span>
          <strong>各阶段输入方式</strong>
          <small>逐字母即时检查；整词允许修改后统一判断</small>
        </span>
        <IconFluentChevronDown20Regular :class="{ expanded: inputModesExpanded }" />
      </button>

      <div v-if="inputModesExpanded" class="stage-mode-groups">
        <section v-for="group in stageGroups" :key="group.key" class="stage-mode-group">
          <button class="group-heading" type="button" @click="expandedGroups[group.key] = !expandedGroups[group.key]">
            <span>{{ group.title }}</span>
            <IconFluentChevronDown20Regular :class="{ expanded: expandedGroups[group.key] }" />
          </button>
          <div v-if="expandedGroups[group.key]" class="group-content">
            <div v-for="item in group.items" :key="item.stage" class="stage-mode-row">
              <span>
                {{ item.label }}
                <small v-if="item.detail">{{ item.detail }}</small>
              </span>
              <WordInputModeSegment
                :model-value="getStageInputMode(item.stage)"
                :aria-label="`${item.label}${item.detail ?? ''}输入方式`"
                @update:model-value="setStageInputMode(item.stage, $event)"
              />
            </div>
          </div>
        </section>
      </div>
    </section>

    <SettingItem
      v-if="hasWholeInputStage"
      title="整词输入判定"
      desc="首次错误只提示；改正后记为 Hard；再次错误、查看答案或跳过记为 Again"
    >
      <RadioGroup v-model="settingStore.wholeInputSubmitMode">
        <Radio :value="WholeInputSubmitMode.Auto" size="default">长度满足自动判定</Radio>
        <Radio :value="WholeInputSubmitMode.Enter" size="default">按 Enter 判定</Radio>
      </RadioGroup>
    </SettingItem>

    <SettingItem :title="$t('practice_sentence')">
      <Switch v-model="settingStore.practiceSentence" />
    </SettingItem>

    <SettingItem :title="$t('word_repeat_setting')" class="gap-0!">
      <RadioGroup v-model="settingStore.repeatCount">
        <Radio :value="1" size="default">1</Radio>
        <Radio :value="2" size="default">2</Radio>
        <Radio :value="3" size="default">3</Radio>
        <Radio :value="5" size="default">5</Radio>
        <Radio :value="100" size="default">{{ $t('custom') }}</Radio>
      </RadioGroup>
      <div class="ml-2 center gap-space" v-if="settingStore.repeatCount === 100">
        <span>{{ $t('repeat_count') }}</span>
        <InputNumber v-model="settingStore.repeatCustomCount" :min="6" :max="15" type="number" />
      </div>
    </SettingItem>

    <SettingItem :title="$t('review_ratio')" :desc="$t('review_ratio_desc')">
      <InputNumber :min="0" :max="10" v-model="settingStore.wordReviewRatio" />
    </SettingItem>

    <SettingItem :title="$t('identify_method')">
      <RadioGroup v-model="settingStore.identifyMethod">
        <Radio :value="IdentifyMethod.SelfAssessment" size="default">{{ $t('self_assessment') }}</Radio>
        <Radio :value="IdentifyMethod.WordTest" size="default">{{ $t('word_test') }}</Radio>
        <Radio :value="IdentifyMethod.QuickIdentify" size="default">快速自测</Radio>
      </RadioGroup>
    </SettingItem>

    <SettingItem title="显示词源和相关词" desc="单词的词源和相关词可能有误，请谨慎使用">
      <Switch v-model="settingStore.showEtymologyAndRelWords" />
    </SettingItem>

    <!--          自动切换-->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('auto_switch')" />
    <SettingItem :title="$t('auto_next_word')" :desc="$t('auto_next_word_desc')">
      <Switch v-model="settingStore.autoNextWord" />
    </SettingItem>

    <SettingItem
      v-if="settingStore.autoNextWord"
      :title="$t('auto_next_word_time')"
      :desc="$t('auto_next_word_time_desc')"
    >
      <InputNumber v-model="settingStore.waitTimeForChangeWord" :min="0" :max="10000" :step="50" type="number" />
      <span class="ml-4">{{ $t('milliseconds') }}</span>
    </SettingItem>

    <SettingItem
      v-else
      title="空格冷却时间"
      desc="手动模式下，单词完成后为避免同时按下最后一个字母和空格键时跳过，忽略空格键的时间"
    >
      <InputNumber
        v-model="settingStore.spaceCooldownTime"
        :disabled="settingStore.autoNextWord"
        :min="0"
        :max="10000"
        :step="50"
        type="number"
      />
      <span class="ml-4">{{ $t('milliseconds') }}</span>
    </SettingItem>

    <!--          字体设置-->
    <div class="line"></div>
    <SettingItem :mainTitle="$t('font_setting')" />
    <SettingItem :title="$t('foreign_font')">
      <Slider :min="10" :max="100" v-model="settingStore.fontSize.wordForeignFontSize" showText showValue unit="px" />
    </SettingItem>
    <SettingItem :title="$t('chinese_font')">
      <Slider :min="10" :max="100" v-model="settingStore.fontSize.wordTranslateFontSize" showText showValue unit="px" />
    </SettingItem>
  </div>
</template>

<style scoped lang="scss">
.input-mode-settings {
  border-top: 1px solid var(--color-line);
  border-bottom: 1px solid var(--color-line);
}

.accordion-heading,
.group-heading {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;

  > span {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.2rem;
  }

  small {
    color: var(--color-font-3);
    font-weight: 400;
  }

  svg {
    flex-shrink: 0;
    transition: transform 0.18s ease;

    &.expanded {
      transform: rotate(180deg);
    }
  }
}

.stage-mode-groups {
  border-top: 1px solid var(--color-line);
}

.stage-mode-group + .stage-mode-group {
  border-top: 1px solid var(--color-line);
}

.group-heading {
  padding: 0.7rem 0.5rem;
  font-weight: 600;
}

.group-content {
  padding: 0 0.5rem 0.6rem;
}

.stage-mode-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8.75rem;
  align-items: center;
  min-height: 2.5rem;
  gap: 0.75rem;

  > span {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.5rem;
    line-height: 1.35;

    small {
      color: var(--color-font-3);
      white-space: nowrap;
    }
  }
}

@media (max-width: 420px) {
  .stage-mode-row {
    grid-template-columns: minmax(0, 1fr) 8rem;
  }

  .stage-mode-row > span {
    align-items: flex-start;
    flex-direction: column;
    gap: 0;
  }
}
</style>
