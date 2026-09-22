<script setup lang="ts">
import { onMounted, nextTick, ref, watch } from 'vue'
import { BaseButton, BasePage, Toast } from '@typewords/base'
import { useSettingStore } from '@typewords/core/stores/setting.ts'
import { getShortcutKey, useEventListener } from '@typewords/core/hooks/event.ts'
import { cloneDeep } from '@typewords/core/utils'
import { APP_NAME, DefaultShortcutKeyMap, Origin } from '@typewords/core/config/env.ts'
import CommonSetting from '@typewords/core/components/setting/CommonSetting.vue'
import FsrsSetting from '@typewords/core/components/setting/FsrsSetting.vue'
import WordSetting from '@typewords/core/components/setting/WordSetting.vue'
import ArticleSetting from '@typewords/core/components/setting/ArticleSetting.vue'
import SoundSetting from '@typewords/core/components/setting/SoundSetting.vue'
import Log from '@typewords/core/components/setting/Log.vue'
import About from '@typewords/core/components/About.vue'
const route = useRoute(), router = useRouter(), { t } = useI18n()
const title = APP_NAME + ' 设置'
useSeoMeta({ title, description: title, ogUrl: Origin + route.fullPath })
const tabIndex = $ref(Number(route.query.index ?? 0))
const settingStore = useSettingStore()
const config = useRuntimeConfig()
const gitLastCommitHash = ref(config.public.latestCommitHash), gitLastCommitTime = ref(config.public.latestCommitTime)
onMounted(() => { if ([5, 6].includes(tabIndex)) router.replace('/account-data') })
const tabs = [{id:0,label:'通用设置'},{id:1,label:'FSRS 设置'},{id:2,label:'单词设置'},{id:3,label:'文章设置'},{id:4,label:'音效设置'},{id:7,label:'快捷键设置'},{id:8,label:'更新记录'},{id:9,label:'关于'}]
let editShortcutKey = $ref('')

const disabledDefaultKeyboardEvent = $computed(() => {
  return editShortcutKey && tabIndex === 7
})

// 监听编辑快捷键状态变化，自动聚焦输入框
watch(
  () => editShortcutKey,
  newVal => {
    if (newVal) {
      // 使用nextTick确保DOM已更新
      nextTick(() => {
        focusShortcutInput()
      })
    }
  }
)

useEventListener('keydown', (e: KeyboardEvent) => {
  if (!disabledDefaultKeyboardEvent) return

  // 确保阻止浏览器默认行为
  e.preventDefault()
  e.stopPropagation()

  let shortcutKey = getShortcutKey(e)

  // console.log('e', e, e.keyCode, e.ctrlKey, e.altKey, e.shiftKey)
  // console.log('key', shortcutKey)

  // if (shortcutKey[shortcutKey.length-1] === '+') {
  //   settingStore.shortcutKeyMap[editShortcutKey] = DefaultShortcutKeyMap[editShortcutKey]
  //   return ElMessage.warning('设备失败！')
  // }

  if (editShortcutKey) {
    if (shortcutKey === 'Delete') {
      settingStore.shortcutKeyMap[editShortcutKey] = ''
    } else {
      // 忽略单独的修饰键
      if (
        shortcutKey === 'Ctrl+' ||
        shortcutKey === 'Alt+' ||
        shortcutKey === 'Shift+' ||
        e.key === 'Control' ||
        e.key === 'Alt' ||
        e.key === 'Shift'
      ) {
        return
      }

      for (const [k, v] of Object.entries(settingStore.shortcutKeyMap)) {
        if (
          v === shortcutKey &&
          k !== editShortcutKey &&
          k !== 'SkipLearnedWord' &&
          editShortcutKey !== 'SkipLearnedWord'
        ) {
          settingStore.shortcutKeyMap[editShortcutKey] = DefaultShortcutKeyMap[editShortcutKey]
          return Toast.warning(t('shortcut_key_duplicate'))
        }
      }
      settingStore.shortcutKeyMap[editShortcutKey] = shortcutKey
    }
  }
})

function handleInputBlur() {
  // 输入框失焦时结束编辑状态
  editShortcutKey = ''
}

function focusShortcutInput() {
  // 找到当前正在编辑的快捷键输入框
  const inputElements = document.querySelectorAll('.set-key input')
  if (inputElements && inputElements.length > 0) {
    // 聚焦第一个找到的输入框
    const inputElement = inputElements[0] as HTMLInputElement
    inputElement.focus()
  }
}

// 快捷键中文名称映射
function getShortcutKeyName(key: string): string {
  const shortcutKeyNameMap: Record<string, string> = {
    SkipLearnedWord: '跳过已学会的重复单词',
    ShowWord: t('shortcut_show_word'),
    EditArticle: t('shortcut_edit_article'),
    Next: t('shortcut_next'),
    Previous: t('shortcut_previous'),
    Ignore: t('shortcut_ignore'),
    ToggleSimple: t('shortcut_toggle_simple'),
    ToggleCollect: t('shortcut_toggle_collect'),
    NextChapter: t('shortcut_next_chapter'),
    PreviousChapter: t('shortcut_previous_chapter'),
    NextStep: t('shortcut_next_step'),
    RepeatChapter: t('shortcut_repeat_chapter'),
    DictationChapter: t('shortcut_dictation_chapter'),
    PlayWordPronunciation: t('shortcut_play_word_pronunciation'),
    ToggleShowTranslate: t('shortcut_toggle_show_translate'),
    ToggleDictation: t('shortcut_toggle_dictation'),
    ToggleTheme: t('shortcut_toggle_theme'),
    ToggleConciseMode: t('shortcut_toggle_concise_mode'),
    ToggleToolbar: t('shortcut_toggle_toolbar'),
    TogglePanel: t('shortcut_toggle_panel'),
    RandomWrite: t('shortcut_random_write'),
    KnowWord: t('shortcut_know_word'),
    UnknownWord: t('shortcut_unknown_word'),
    MasteredWord: t('shortcut_mastered_word'),
    ChooseA: t('shortcut_choose_a'),
    ChooseB: t('shortcut_choose_b'),
    ChooseC: t('shortcut_choose_c'),
    ChooseD: t('shortcut_choose_d'),
    PlaySentence1: t('shortcut_play_sentence_1'),
    PlaySentence2: t('shortcut_play_sentence_2'),
    PlaySentence3: t('shortcut_play_sentence_3'),
    PlaySentence4: t('shortcut_play_sentence_4'),
    PlaySentence5: t('shortcut_play_sentence_5'),
    PlaySentence6: t('shortcut_play_sentence_6'),
    PlaySentence7: t('shortcut_play_sentence_7'),
    PlaySentence8: t('shortcut_play_sentence_8'),
    PlaySentence9: t('shortcut_play_sentence_9'),
  }

  return shortcutKeyNameMap[key] || key
}

function formatShortcutKey(key: unknown) {
  const shortcutKey = String(key ?? '')
  return shortcutKey === 'Space' ? '空格' : shortcutKey
}

function resetShortcutKeyMap() {
  editShortcutKey = ''
  settingStore.shortcutKeyMap = cloneDeep(DefaultShortcutKeyMap)
  Toast.success(t('restore_success'))
}


</script>
<template>
  <BasePage>
    <div class="setting text-md card flex flex-col">
      <div class="page-title text-align-center">{{ $t('setting') }}</div>
      <div class="settings-body flex flex-1 overflow-hidden gap-4">
        <div class="left"><div class="tabs">
          <button v-for="tab in tabs" :key="tab.id" class="tab" :class="{active:tabIndex===tab.id}" @click="tabIndex=tab.id">{{tab.label}}</button>
          <NuxtLink class="tab" to="/account-data">账号与数据</NuxtLink>
        </div></div>
        <div class="col-line"></div>
        <div class="flex-1 overflow-y-auto overflow-x-hidden pr-4 content">
          <CommonSetting v-if="tabIndex===0" /><FsrsSetting v-if="tabIndex===1" /><WordSetting v-if="tabIndex===2" />
          <ArticleSetting v-if="tabIndex===3" /><SoundSetting v-if="tabIndex===4" />
          <div class="body" v-if="tabIndex === 7">
            <div class="row">
              <label class="main-title">{{ $t('function') }}</label>
              <div class="wrapper">{{ $t('shortcut_key') }}</div>
            </div>
            <div class="scroll">
              <div class="row" v-for="item of Object.entries(settingStore.shortcutKeyMap)">
                <label class="item-title">{{ getShortcutKeyName(item[0]) }}</label>
                <div class="wrapper" @click="editShortcutKey = item[0]">
                  <div class="set-key" v-if="editShortcutKey === item[0]">
                    <input
                      ref="shortcutInput"
                      :value="item[1] ? formatShortcutKey(item[1]) : $t('no_shortcut_set')"
                      readonly
                      type="text"
                      @blur="handleInputBlur"
                    />
                    <span @click.stop="editShortcutKey = ''"
                      >{{ $t('press_key_to_set') }}，<span class="text-red!">{{
                        $t('click_here_when_done')
                      }}</span></span
                    >
                  </div>
                  <div v-else>
                    <div v-if="item[1]">{{ formatShortcutKey(item[1]) }}</div>
                    <span v-else>{{ $t('no_shortcut_set') }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="row">
              <label class="item-title"></label>
              <div class="wrapper">
                <BaseButton size="large"  @click="resetShortcutKeyMap">{{ $t('restore_default') }}</BaseButton>
              </div>
            </div>
          </div>


          <Log v-if="tabIndex===8" />
          <div v-if="tabIndex===9"><About /><p class="text-sm mt-5">Build {{gitLastCommitHash}} · {{gitLastCommitTime}}</p></div>
        </div>
      </div>
    </div>
  </BasePage>
</template>
<style scoped lang="scss">
.col-line {
  border-right: 2px solid var(--color-line);
}

.setting {
  height: calc(100dvh - 3rem);
  min-width: 0;
  .left {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;

    .tabs {
      padding: 0.6rem 0;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;

      .tab {
        @apply cursor-pointer flex items-center relative;
        border-radius: 0.5rem;
        @apply w-auto p-1 lg:w-40 lg:p-2;
        gap: 0.6rem;
        transition: all 0.5s;

        svg {
          @apply text-lg shrink-0;
        }

        &:hover {
          background: var(--color-fourth);
        }

        &.active {
          background: var(--color-fourth);
        }
      }
    }
  }

  .content {
    min-width: 0;
    min-height: 0;
    .row {
      min-height: 2.6rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: calc(var(--space) * 5);

      .wrapper {
        height: 2rem;
        flex: 1;
        display: flex;
        justify-content: flex-end;
        gap: var(--space);

        span {
          text-align: right;
          color: gray;
        }

        .set-key {
          align-items: center;

          input {
            width: 9rem;
            box-sizing: border-box;
            margin-right: 0.6rem;
            height: 1.8rem;
            outline: none;
            font-size: 1rem;
            border: 1px solid gray;
            border-radius: 0.2rem;
            padding: 0 0.3rem;
            background: var(--color-second);
            color: var(--color-font-1);
          }
        }
      }

      .main-title {
        font-size: 1.1rem;
        font-weight: bold;
      }

      .item-title {
        font-size: 1rem;
      }

      .sub-title {
        font-size: 0.9rem;
      }
    }

    .body {
      height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .scroll {
      flex: 1;
      padding-right: 0.6rem;
      overflow: auto;
    }

    .line {
      border-bottom: 1px solid #c4c3c3;
    }
  }
}
@media (max-width: 800px) {
  .setting { height: calc(100dvh - 8rem); }
  .settings-body { flex-direction: column; gap: .75rem; min-height: 0; }
  .setting .left { align-items: stretch; flex-shrink: 0; }
  .setting .left .tabs { flex-direction: row; flex-wrap: wrap; gap: .35rem; }
  .setting .left .tabs .tab { font-size: .8rem; padding: .4rem; }
  .col-line { border-right: 0; border-bottom: 1px solid var(--color-line); }
  .setting .content { padding-right: .25rem; }
}
</style>
