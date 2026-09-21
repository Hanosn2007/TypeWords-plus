<script setup lang="ts">
import { loadLibraryBook, loadWordCatalog } from '@typewords/core/utils/libraryBooks.ts'
import { nextTick, onMounted, onUnmounted, provide, watch } from 'vue'
import Statistics from '@typewords/core/components/word/Statistics.vue'
import { emitter, EventKey, useEvents } from '@typewords/core/utils/eventBus.ts'
import { resolveWordInputMode, useSettingStore } from '@typewords/core/stores/setting.ts'
import { useRuntimeStore } from '@typewords/core/stores/runtime.ts'
import type { Dict, PracticeData, TaskWords, Word } from '@typewords/core/types/types.ts'
import { getShortcutKey, useStartKeyboardEventListener } from '@typewords/core/hooks/event.ts'
import { useDisableEventListener } from '@typewords/utils'
import useTheme from '@typewords/core/hooks/theme.ts'
import { getCurrentStudyWord, useWordOptions } from '@typewords/core/hooks/dict.ts'
import { openWordCollectPicker } from '@typewords/core/hooks/useWordCollectPicker.ts'
import {
  _getDictDataByUrl,
  _nextTick,
  cloneDeep,
  getShufflePracticeWords,
  isDictIdMatch,
  isMobile,
  loadJsLib,
  resourceWrap,
  shuffle,
  throttle,
} from '@typewords/core/utils'
import { useRoute, useRouter } from 'vue-router'
import Footer from '@typewords/core/components/word/Footer.vue'
import Panel from '@typewords/core/components/Panel.vue'
import { BaseIcon, Toast, ToastComponent, Tooltip } from '@typewords/base'
import WordList from '@typewords/core/components/list/WordList.vue'
import TypeWord from '@typewords/core/components/word/TypeWord.vue'
import Empty from '@typewords/core/components/Empty.vue'
import { useBaseStore } from '@typewords/core/stores/base.ts'
import { usePracticeStore, type PracticeState, type TimerPauseReason } from '@typewords/core/stores/practice.ts'
import { getDefaultDict, getDefaultWord } from '@typewords/core/types/func.ts'
import ConflictNotice from '@typewords/core/components/dialog/ConflictNotice.vue'
import PracticeLayout from '@typewords/core/components/PracticeLayout.vue'
import {
  AppEnv,
  DICT_LIST,
  LIB_JS_URL,
  TourConfig,
  WordPracticeModeStageMap,
  WordPracticeStageNameMap,
} from '@typewords/core/config/env.ts'
import { watchOnce } from '@vueuse/core'
import { addStat, setUserDictProp } from '@typewords/core/apis'
import GroupList from '@typewords/core/components/word/GroupList.vue'
import { useDataSyncPersistence } from '@typewords/core/composables/useDataSyncPersistence.ts'
import { bookPracticeSettingsKey } from '@typewords/core/composables/bookPracticeSettings.ts'
import { flushStatToStore, usePracticeWordPersistence } from '@typewords/core/composables/usePracticePersistence.ts'
import type { PracticeStageCheckpoint } from '@typewords/core/utils/cache.ts'
import { crossedPracticeTimeSaveInterval, getPracticeTimerCutoff } from '@typewords/core/utils/practiceTime.ts'
import {
  IdentifyMethod,
  ShortcutKey,
  WordInputMode,
  WordPracticeMode,
  WordPracticeStage,
  WordPracticeType,
} from '@typewords/core/types/enum.ts'
import ConflictNotice2 from '@typewords/core/components/dialog/ConflictNotice2.vue'
import { createEmptyCard, Rating } from 'ts-fsrs'
import { useGetGradeByWrongTimes, useNextCard } from '@typewords/core/hooks/fsrs.ts'
import WordMarkPickList, { type WordMarkPickResult } from '@typewords/core/components/word/WordMarkPickList.vue'
import { buildQuestion } from '@typewords/core/utils/word-test.ts'
import { completeBookLearningTask, findOtherBookLearning, getBookLearning, getUnitProgress, isCompletedPracticeCache, normalizeLearningWord, refreshUnitBookProgress } from '@typewords/core/utils/bookLearning.ts'
import CollectNotice from '@typewords/core/components/dialog/CollectNotice.vue'

const { isWordSimple, toggleWordSimple } = useWordOptions()
const settingStore = useSettingStore()
const runtimeStore = useRuntimeStore()
const { toggleTheme } = useTheme()
const router = useRouter()
const route = useRoute()
const practiceDictId = String(route.params.id)
const store = useBaseStore()
const statStore = usePracticeStore()
const dataSync = useDataSyncPersistence()
let sessionMode = settingStore.wordPracticeMode
const wordPersistence = usePracticeWordPersistence({ free: () => sessionMode === WordPracticeMode.Free })
let { getGradeByWrongTimes } = useGetGradeByWrongTimes()
let { nextCard } = useNextCard()
const typingRef: any = $ref()
let showConflictNotice = $ref(false)
let showCollectNotice = $ref(false)
let showConflictNotice2 = $ref(false)
let isComplete = $ref(false)
let loading = $ref(false)
let settling = $ref(false)
let resettingBookTask = $ref(false)
let taskSettled = false
let timer = $ref<any>(-1)
let isFocus = true
const IDLE_MS = 3 * 60 * 1000
let lastKeyActivity = Date.now()
let visibilityResumeTimer: ReturnType<typeof setTimeout> | null = null
let taskWords = $ref<TaskWords>({
  new: [],
  review: [],
})
let skipCheckpoint = $ref<PracticeStageCheckpoint | null>(null)
let isManualStageSkip = false
let skipStepRunning = false
let isRestoringSkipCheckpoint = false
let autoDuplicatePaused = false
let duplicateSkipRunning = $ref(false)
let duplicateUndo = $ref<{
  word: string
  practiceData: PracticeData
  stat: PracticeState
  learning: ReturnType<typeof getBookLearning>
  lastLearnIndex: number
  complete: boolean
  statisticsLength: number
  practiceType: WordPracticeType
} | null>(null)


if (import.meta.client) {
}
//watch 实例列表，用于本地代码修改hrm后，导致重复watch
let watchRefList = []

function getDefaultPracticeData(origin?: Partial<PracticeData>, val?: Partial<PracticeData>): PracticeData {
  return Object.assign(origin, {
    index: 0,
    words: [],
    wrongWords: [],
    excludeWords: [],
    duplicateSkippedWords: [],
    allWrongWords: [],
    wrongTimesMap: {},
    ratingMap: {},
    wrongTimes: 0,
    isTypingWrongWord: false,
    question: null,
    ...val,
  })
}
let data = $ref<PracticeData>(getDefaultPracticeData({}))

watch(
  () => data.words,
  () => {
    updateQuestion()
    handleResumeTimer()
  }
)
watch(
  () => data.index,
  () => {
    updateQuestion()
    handleResumeTimer()
  }
)

function updateQuestion() {
  if (data.words?.[data.index]) {
    data.question = buildQuestion(data.words[data.index], allWords)
  }
}

provide('practiceData', data)
provide('practiceTaskWords', taskWords)

function bumpPracticeTimerActivity() {
  const now = Date.now()
  // A delayed browser callback can arrive only when the user types again.
  // Settle the old activity window first, or resetting lastKeyActivity here
  // would incorrectly make the whole background gap look active.
  if (isFocus && !statStore.timerPaused) {
    const cutoff = getPracticeTimerCutoff(now, lastKeyActivity, IDLE_MS)
    statStore.syncTimer(cutoff)
    if (now >= lastKeyActivity + IDLE_MS) statStore.pauseTimer('auto_idle', cutoff)
  }
  lastKeyActivity = now
}
provide('bumpPracticeTimerActivity', bumpPracticeTimerActivity)

function getTimerCutoff(now: number = Date.now()) {
  return getPracticeTimerCutoff(now, lastKeyActivity, IDLE_MS)
}

function syncPracticeTimer(now: number = Date.now()): boolean {
  if (!isFocus || statStore.timerPaused) return false
  const cutoff = getTimerCutoff(now)
  statStore.syncTimer(cutoff)
  if (now >= lastKeyActivity + IDLE_MS) {
    statStore.pauseTimer('auto_idle', cutoff)
    return false
  }
  return true
}

function pausePracticeTimer(reason: TimerPauseReason, now: number = Date.now()) {
  statStore.pauseTimer(reason, getTimerCutoff(now))
}

function clearVisibilityResumeTimer() {
  if (!visibilityResumeTimer) return
  clearTimeout(visibilityResumeTimer)
  visibilityResumeTimer = null
}

function handleResumeTimer() {
  if (!isFocus) return
  clearVisibilityResumeTimer()
  bumpPracticeTimerActivity()
  if (statStore.timerPaused) {
    statStore.resumeTimer(Date.now())
    Toast.success('已恢复计时')
  }
}

provide('togglePracticeTimer', () => {
  if (statStore.timerPaused) handleResumeTimer()
  else pausePracticeTimer('manual')
})

async function loadDict() {
  try {
    let dict = store.word.bookList.find(v => isDictIdMatch(v, practiceDictId))
    if (!dict) {
      const dictList = await loadWordCatalog(resourceWrap(DICT_LIST.WORD.ALL))
      dict = dictList.find(v => isDictIdMatch(v, practiceDictId)) as Dict | undefined
    }

    if (!dict?.id) {
      await router.push('/words')
      return
    }

    if (!dict.custom) dict = await _getDictDataByUrl(dict)
    if (!dict.words.length) {
      await router.push('/words')
      Toast.warning('没有单词可学习！')
      return
    }

    await store.changeDict(dict)
    const bookMode = getBookLearning(store.sdict).practiceMode
    if (bookMode !== undefined) settingStore.wordPracticeMode = bookMode
    await initData(null, true)
  } catch (error) {
    console.warn('恢复单词练习失败', error)
    Toast.error(error instanceof Error ? error.message : '恢复练习失败')
    await router.push('/words')
  } finally {
    loading = false
  }
}

watch(
  [() => store.load, () => loading],
  ([a, b]) => {
    if (a && b) loadDict()
  },
  { immediate: true }
)

function saveBeforeUpdate(event: Event) {
  ;(event as CustomEvent<Promise<unknown>[]>).detail.push(savePracticeDataIns('update'))
}
const onvisibilitychange = async () => {
  isFocus = !document.hidden
  if (isFocus) {
    bumpPracticeTimerActivity()
    if (statStore.timerPaused && statStore.timerPauseReason === 'auto_visibility' && !visibilityResumeTimer) {
      //特意延迟提示用户，让用户看到，免得用户焦虑，以为没暂停
      visibilityResumeTimer = setTimeout(() => {
        visibilityResumeTimer = null
        if (!isFocus || !statStore.timerPaused || statStore.timerPauseReason !== 'auto_visibility') return
        bumpPracticeTimerActivity()
        statStore.resumeTimer(Date.now())
        Toast.success('已自动恢复计时')
      }, 1500)
    }
    if (runtimeStore.globalLoading) return
    runtimeStore.globalLoading = true
    try {
      await savePracticeData('visibility-focus')
      await wordPersistence.flushRemote()
    } finally {
      runtimeStore.globalLoading = false
    }
  } else {
    clearVisibilityResumeTimer()
    pausePracticeTimer('auto_visibility')
    void savePracticeData('visibility-hidden').then(() => wordPersistence.flushRemote(true))
  }
}

const onPageHide = () => {
  void savePracticeData('pagehide').then(() => wordPersistence.flushRemote(true))
}

onMounted(async () => {
  //如果是从单词学习主页过来的，就直接使用；否则等待加载
  if (String(runtimeStore.routeData?.dictId) === practiceDictId && String(store.sdict.id) === practiceDictId) {
    await initData(null, true)
  } else {
    loading = true
  }
  if (!route.query.guide) {
    showConflictNotice = true
    setTimeout(() => {
      showCollectNotice = true
    }, 10000)
  }
  document.removeEventListener('visibilitychange', onvisibilitychange)
  document.addEventListener('visibilitychange', onvisibilitychange)
  window.addEventListener('typewords-save-before-update', saveBeforeUpdate)
  window.removeEventListener('pagehide', onPageHide)
  window.addEventListener('pagehide', onPageHide)
})

onUnmounted(() => {
  window.removeEventListener('typewords-save-before-update', saveBeforeUpdate)
  document.removeEventListener('visibilitychange', onvisibilitychange)
  window.removeEventListener('pagehide', onPageHide)
  clearVisibilityResumeTimer()
  void savePracticeData('onUnmounted').then(() => wordPersistence.flushRemote(true))
  // The cache keeps its accounting baseline, but other practice surfaces must
  // not inherit the word page's runtime timer mode.
  statStore.disableTimeAccounting()
  timer && clearInterval(timer)
  watchRefList.map(v => v?.stop())
})

watchOnce(
  () => data.words.length,
  (newVal, oldVal) => {
    //如果是从无值变有值，代表是开始
    if (!oldVal && newVal) {
      _nextTick(async () => {
        const Shepherd = await loadJsLib('Shepherd', LIB_JS_URL.SHEPHERD)
        const tour = new Shepherd.Tour(TourConfig)
        tour.on('cancel', () => {
          localStorage.setItem('tour-guide', '1')
        })
        tour.addStep({
          id: 'step5',
          text: '这里可以练习拼写单词，只需要按下键盘上对应的按键即可，没有输入框！',
          attachTo: { element: '#word', on: 'bottom' },
          buttons: [
            {
              text: `关闭`,
              action() {
                settingStore.first = false
                tour.next()
                setTimeout(() => {
                  showConflictNotice = true
                }, 1500)
                setTimeout(() => {
                  showCollectNotice = true
                }, 10000)
              },
            },
          ],
        })

        const r = localStorage.getItem('tour-guide')
        if (settingStore.first && !r && !isMobile()) {
          tour.start()
        }
      }, 500)
    }
  }
)

let allWords: Word[] = []
let practiceRouteOptions: any = null

let isIniting = ref(true)
let activePracticeType = $ref(settingStore.wordPracticeType)

function assertCanApplyBookSettings() {
  if (settling || resettingBookTask || isIniting.value || duplicateSkipRunning || skipStepRunning || isRestoringSkipCheckpoint) {
    throw new Error('练习正在保存，请稍后重试。')
  }
}

provide(bookPracticeSettingsKey, {
  dictId: () => practiceDictId,
  snapshot: async () => {
    assertCanApplyBookSettings()
    const completed = taskSettled || isComplete || statStore.stage === WordPracticeStage.Complete
    return {
      completed,
      hasUnsavedAnswer: !completed && !!typingRef?.hasStartedAnswer?.(),
      cache: completed ? null : {
        dictId: practiceDictId,
        practiceType: activePracticeType,
        practiceMode: settingStore.wordPracticeMode,
        taskWords,
        practiceData: data,
        statStoreData: statStore.$state,
        skipCheckpoint,
      },
    }
  },
  apply: async (saveSettings, rebuild) => {
    assertCanApplyBookSettings()
    if (!rebuild) return await saveSettings()
    resettingBookTask = true
    isIniting.value = true
    clearInterval(timer)
    try {
      await saveSettings()
      await wordPersistence.clear(practiceDictId)
      if (store.sdict.library) Object.assign(store.sdict, await loadLibraryBook(store.sdict))
      practiceRouteOptions = null
      emitter.emit(EventKey.resetWord)
      await initData(getCurrentStudyWord())
      resettingBookTask = false
      await savePracticeDataIns('book-settings-restart')
    } finally {
      resettingBookTask = false
      isIniting.value = false
      if (!taskSettled && !isComplete) startPracticeTimer()
    }
  },
})

function setPracticeType(type: WordPracticeType) {
  activePracticeType = type
  settingStore.wordPracticeType = type
}

watch(
  () => settingStore.wordPracticeType,
  type => {
    if (!isIniting.value && type !== activePracticeType) {
      settingStore.wordPracticeType = activePracticeType
    }
  }
)

async function initData(initVal?: TaskWords, init: boolean = false) {
  sessionMode = settingStore.wordPracticeMode
  isIniting.value = true
  taskSettled = false
  //只有初始化时，才读取缓存（本地 + 可选 Supabase）
  if (init) {
    let d = runtimeStore.routeData
    runtimeStore.routeData = null
    if (String(d?.dictId) !== practiceDictId) d = null
    if (isCompletedPracticeCache(store.sdict, d)) d = null
    const routeVersion = d?.libraryVersion ?? d?.taskWords?.libraryVersion
    if (d && store.sdict.library && routeVersion) {
      Object.assign(store.sdict, await loadLibraryBook(store.sdict, routeVersion))
    }
    practiceRouteOptions = d
    if (!d) {
      d = await wordPersistence.load(practiceDictId)
    }
    if (isCompletedPracticeCache(store.sdict, d)) d = null
    if (!d) {
      return await initData(getCurrentStudyWord())
    }
    if (d.dictId && d.dictId !== practiceDictId) {
      return await initData(getCurrentStudyWord())
    }
    if (!(d.practiceData && d.statStoreData)) {
      return await initData(d.taskWords)
    }
    if (d.practiceMode !== undefined) settingStore.wordPracticeMode = d.practiceMode
    sessionMode = settingStore.wordPracticeMode
    console.log('initData')
    taskWords = Object.assign(taskWords, { settings: undefined, unitId: undefined, unitScannedWords: undefined, unitReview: undefined, libraryVersion: undefined }, d.taskWords)
    skipCheckpoint = d.skipCheckpoint ?? null
    //这里直接赋值的话，provide后的inject获取不到最新值
    data = getDefaultPracticeData(data, d.practiceData)
    const learning = getBookLearning(store.sdict)
    if (settingStore.wordPracticeMode !== WordPracticeMode.Free) learning.skippedWords = Array.from(new Set([...learning.skippedWords, ...(data.duplicateSkippedWords ?? [])]))
    statStore.$patch(d.statStoreData)
    // A cache created before unified timing has no accounting marker. Preserve
    // its saved spend as the legacy baseline before appending any new segment.
    statStore.initializeTimeAccounting(!d.statStoreData.timeAccounting)
    const restoredPracticeType = resolveRestoredPracticeType(
      statStore.stage,
      d.practiceType,
      data.isTypingWrongWord
    )
    setPracticeType(restoredPracticeType)
    watchPracticeType(restoredPracticeType)
    // 恢复缓存后不能续接旧片段，避免将离线间隔计入有效时长。
    if (!statStore.timerPaused) {
      statStore.startTimerSegment(Date.now())
    }
  } else {
    console.log('initData')
    skipCheckpoint = null
    duplicateUndo = null
    autoDuplicatePaused = false
    // taskWords = initVal
    //不能直接赋值，会导致 inject 的数据为默认值
    taskWords = Object.assign(taskWords, { settings: undefined, unitId: undefined, unitScannedWords: undefined, unitReview: undefined, libraryVersion: undefined }, initVal)

    if (settingStore.wordPracticeMode === WordPracticeMode.Shuffle) {
      setPracticeType(WordPracticeType.Dictation)
      data = getDefaultPracticeData(data, { words: taskWords.review })
      statStore.stage = WordPracticeStage.Shuffle
      statStore.total = taskWords.review.length
      statStore.newWordNumber = 0
      statStore.reviewWordNumber = 0
    } else if (settingStore.wordPracticeMode === WordPracticeMode.Review) {
      data = getDefaultPracticeData(data, { words: taskWords.review })
      if (taskWords.review.length) {
        statStore.stage = WordPracticeStage.IdentifyReview
      } else {
        Toast.warning('没有可复习的单词！')
        router.push('/words')
      }
      statStore.total = taskWords.review.length
      statStore.newWordNumber = 0
      statStore.reviewWordNumber = taskWords.review.length
    } else {
      if (taskWords.new.length === 0) {
        if (taskWords.review.length) {
          data = getDefaultPracticeData(data, { words: taskWords.review })
          if (settingStore.wordPracticeMode === WordPracticeMode.System) {
            statStore.stage = WordPracticeStage.IdentifyReview
          } else if (settingStore.wordPracticeMode === WordPracticeMode.Free) {
            statStore.stage = WordPracticeModeStageMap[settingStore.wordPracticeMode][0]
          } else if (settingStore.wordPracticeMode === WordPracticeMode.IdentifyOnly) {
            statStore.stage = WordPracticeStage.IdentifyReview
          } else if (settingStore.wordPracticeMode === WordPracticeMode.DictationOnly) {
            statStore.stage = WordPracticeStage.DictationReview
          } else if (settingStore.wordPracticeMode === WordPracticeMode.ListenOnly) {
            statStore.stage = WordPracticeStage.ListenReview
          }
        } else {
          data = getDefaultPracticeData(data)
          Toast.warning('没有可学习的单词！')
          router.push('/words')
        }
      } else {
        data = getDefaultPracticeData(data, { words: taskWords.new })
        statStore.stage = WordPracticeModeStageMap[settingStore.wordPracticeMode][0]
      }
      statStore.total = taskWords.review.length + taskWords.new.length
      statStore.newWordNumber = taskWords.new.length
      statStore.reviewWordNumber = taskWords.review.length
    }

    statStore.startDate = Date.now()
    statStore.skippedWordNumber = 0
    statStore.inputWordNumber = 0
    statStore.wrong = 0
    statStore.spend = 0
    statStore.segments = []
    statStore.resetTimeAccounting()
    statStore.startTimerSegment(Date.now())
    watchStage(statStore.stage)
    watchPracticeType(settingStore.wordPracticeType)
  }

  getBookLearning(store.sdict).practiceMode = settingStore.wordPracticeMode
  if (store.sdict.units?.length && typeof taskWords.unitId === 'string') {
    // The unfinished task owns the selection when a device restores an older local choice.
    getBookLearning(store.sdict).selectedUnitId = taskWords.unitId
  }

  // 纯复习不能把首页同时生成的新词当成已学，也不能推进新词游标。
  if ([WordPracticeMode.Review, WordPracticeMode.Shuffle].includes(settingStore.wordPracticeMode)) {
    taskWords.new = []
    taskWords.endIndex = taskWords.startIndex ?? store.sdict.lastLearnIndex
    taskWords.unitScannedWords = []
    taskWords.unitReview = true
  }

  // 初始化 Question
  let dictId: any = practiceDictId
  let d = store.word.bookList.find(v => v.id === dictId)
  if (!d) d = store.sdict
  if (!d?.id) return router.push('/words')
  allWords = shuffle(d.words)
  updateQuestion()

  startPracticeTimer()
  isIniting.value = false
  settling = isComplete = false
}

function startPracticeTimer() {
  clearInterval(timer)
  lastKeyActivity = Date.now()
  timer = setInterval(() => {
    syncPracticeTimer()
  }, 1000)
}

const word = $computed<Word>(() => {
  return data.words[data.index] ?? getDefaultWord()
})
const prevWord: Word = $computed(() => {
  return data.words?.[data.index - 1] ?? undefined
})
const nextWord: Word = $computed(() => {
  return data.words?.[data.index + 1] ?? undefined
})

const duplicateSources = $computed(() => findOtherBookLearning(store.word.bookList, store.sdict, word.word))
const duplicateSourceLabel = $computed(() => duplicateSources.map(source => `「${source.name}」${source.mastered ? '（已掌握）' : ''}`).join('、'))
const duplicateShortcutLabel = $computed(() => {
  const key = settingStore.shortcutKeyMap[ShortcutKey.SkipLearnedWord]
  return key === 'Space' ? '空格' : key || '未设置快捷键'
})

function handleDuplicateShortcut(event: KeyboardEvent): boolean {
  if (event.repeat || event.isComposing || event.keyCode === 229 || isIniting.value || isComplete || settling) return false
  if (getBookLearning(store.sdict).duplicateMode === 'off' || !duplicateSources.length) return false
  if (getShortcutKey(event) !== settingStore.shortcutKeyMap[ShortcutKey.SkipLearnedWord]) return false
  if (!typingRef || typingRef.hasStartedAnswer?.()) return false
  if (settingStore.wordPracticeType === WordPracticeType.Identify && settingStore.identifyMethod === IdentifyMethod.QuickIdentify) return false
  void skipDuplicateWord()
  return true
}

async function skipDuplicateWord() {
  if (duplicateSkipRunning || isIniting.value || settling || isComplete || !word.word || !duplicateSources.length) return
  duplicateSkipRunning = true
  try {
    const key = normalizeLearningWord(word.word)
    duplicateUndo = {
      word: word.word,
      practiceData: cloneDeep(data),
      stat: cloneDeep(statStore.$state),
      learning: cloneDeep(getBookLearning(store.sdict)),
      lastLearnIndex: store.sdict.lastLearnIndex,
      complete: store.sdict.complete,
      statisticsLength: store.sdict.statistics.length,
      practiceType: activePracticeType,
    }
    const learning = getBookLearning(store.sdict)
    if (settingStore.wordPracticeMode !== WordPracticeMode.Free && !learning.skippedWords.includes(key)) learning.skippedWords.push(key)
    data.duplicateSkippedWords = Array.from(new Set([...(data.duplicateSkippedWords ?? []), key]))
    statStore.skippedWordNumber = data.duplicateSkippedWords.length
    if (!data.excludeWords.includes(word.word)) data.excludeWords.push(word.word)
    data.wrongWords = data.wrongWords.filter(item => normalizeLearningWord(item.word) !== key)
    next(false)
    await savePracticeData('skip-duplicate')
    if (!isComplete) await dataSync.saveDictState(store.$state, { pullWhenRemoteNewer: false })
  } finally {
    duplicateSkipRunning = false
  }
}

async function undoDuplicateSkip() {
  if (!duplicateUndo || settling) return
  const checkpoint = duplicateUndo
  duplicateUndo = null
  autoDuplicatePaused = true
  isRestoringSkipCheckpoint = true
  try {
    store.sdict.learning = checkpoint.learning
    store.sdict.lastLearnIndex = checkpoint.lastLearnIndex
    store.sdict.complete = checkpoint.complete
    store.sdict.statistics.splice(checkpoint.statisticsLength)
    isComplete = false
    taskSettled = false
    data = getDefaultPracticeData(data, cloneDeep(checkpoint.practiceData))
    statStore.$patch(checkpoint.stat)
    statStore.initializeTimeAccounting(!checkpoint.stat.timeAccounting)
    if (!statStore.timerPaused) statStore.startTimerSegment()
    setPracticeType(checkpoint.practiceType)
    watchPracticeType(checkpoint.practiceType)
    // Recreate the timer after undoing a final-word skip.
    startPracticeTimer()
    emitter.emit(EventKey.resetWord)
    await nextTick()
    await savePracticeDataIns('undo-duplicate', true)
    await dataSync.saveDictState(store.$state, { pullWhenRemoteNewer: false })
  } finally {
    isRestoringSkipCheckpoint = false
  }
}

watch(
  [() => word.word, () => isIniting.value, () => duplicateSkipRunning],
  async () => {
    if (isIniting.value || autoDuplicatePaused || duplicateSkipRunning || isComplete || settling) return
    if (getBookLearning(store.sdict).duplicateMode !== 'auto' || !duplicateSources.some(source => source.mastered)) return
    if (settingStore.wordPracticeType === WordPracticeType.Identify && settingStore.identifyMethod === IdentifyMethod.QuickIdentify) return
    await nextTick()
    if (!typingRef?.hasStartedAnswer?.()) await skipDuplicateWord()
  },
  { flush: 'post' }
)

//因为有时要从缓存里面读数据，这时的状态、进度保持原样，所以只能惰性监听，所以没缓存时主动调用一个，以更新为符合当前进度的状态、模式
//比如，每个阶段都有错误复习这个流程，当正在错词复习时，如果执行state监听，就可能恢复成stage默认的配置项（模式、dictation、translate）
function watchStage(n: WordPracticeStage) {
  switch (n) {
    case WordPracticeStage.DictationNewWord:
    case WordPracticeStage.DictationReview:
    case WordPracticeStage.Shuffle:
      setPracticeType(WordPracticeType.Dictation)
      break
    case WordPracticeStage.ListenNewWord:
    case WordPracticeStage.ListenReview:
      setPracticeType(WordPracticeType.Listen)
      break
    case WordPracticeStage.FollowWriteNewWord:
    case WordPracticeStage.FollowWriteReview:
      setPracticeType(WordPracticeType.FollowWrite)
      break
    case WordPracticeStage.IdentifyNewWord:
    case WordPracticeStage.IdentifyReview:
      setPracticeType(WordPracticeType.Identify)
      break
  }
}

function resolveRestoredPracticeType(
  stage: WordPracticeStage,
  savedType: WordPracticeType | undefined,
  isTypingWrongWord: boolean
): WordPracticeType {
  if (isTypingWrongWord) {
    return [WordPracticeType.FollowWrite, WordPracticeType.Spell].includes(savedType as WordPracticeType)
      ? (savedType as WordPracticeType)
      : WordPracticeType.FollowWrite
  }

  switch (stage) {
    case WordPracticeStage.FollowWriteNewWord:
    case WordPracticeStage.FollowWriteReview:
      return [WordPracticeType.FollowWrite, WordPracticeType.Spell].includes(savedType as WordPracticeType)
        ? (savedType as WordPracticeType)
        : WordPracticeType.FollowWrite
    case WordPracticeStage.IdentifyNewWord:
    case WordPracticeStage.IdentifyReview:
      return WordPracticeType.Identify
    case WordPracticeStage.ListenNewWord:
    case WordPracticeStage.ListenReview:
      return WordPracticeType.Listen
    case WordPracticeStage.DictationNewWord:
    case WordPracticeStage.DictationReview:
    case WordPracticeStage.Shuffle:
      return WordPracticeType.Dictation
    default:
      return savedType ?? settingStore.wordPracticeType
  }
}

function watchPracticeType(n: WordPracticeType) {
  if (settingStore.wordPracticeMode === WordPracticeMode.Free) return
  switch (n) {
    case WordPracticeType.Spell:
    case WordPracticeType.Dictation:
      settingStore.dictation = true
      settingStore.translate = true
      break
    case WordPracticeType.Listen:
      settingStore.dictation = true
      settingStore.translate = false
      break
    case WordPracticeType.FollowWrite:
      settingStore.dictation = false
      settingStore.translate = true
      break
    case WordPracticeType.Identify:
      settingStore.dictation = false
      settingStore.translate = false
      break
  }
}

const groupSize = 7

function wordLoop() {
  // 学习模式
  if (settingStore.wordPracticeType === WordPracticeType.FollowWrite) {
    data.index++
    // 到达一个组末尾，就切换到拼写模式
    if (data.index % groupSize === 0) {
      setPracticeType(WordPracticeType.Spell)
      data.index -= groupSize // 回到刚学单词开头
    }
  } else {
    // 拼写模式
    data.index++
    // 拼写走完一组，切回跟写模式
    if (data.index % groupSize === 0) {
      setPracticeType(WordPracticeType.FollowWrite)
    }
  }
}

function nextStage(originList: Word[], log: string = '', toast: boolean = false) {
  if (!isManualStageSkip) skipCheckpoint = null
  //每次都判断，因为每次都可能新增已掌握的单词
  let list = originList.filter(v => !checkWordIsNeedNext(v))
  console.log(log)
  statStore.stage = statStore.nextStage
  if (list.length) {
    data.words = list
    data.index = 0
  } else {
    console.log(log + ':无单词略过')
    // 清空列表并重置索引，避免 next(false) 再次进入「最后一个词」分支导致死循环
    data.words = []
    data.index = 0
    next(false)
  }
}

async function complete() {
  if (!isComplete) {
    let start = Date.now()
    console.log('全完学完了')
    isComplete = true
    settling = true
    runtimeStore.globalLoading = true
    syncPracticeTimer()
    clearInterval(timer)

    const freeSession = sessionMode === WordPracticeMode.Free
    const sessionLearning = getBookLearning(store.sdict)
    if (!freeSession) {
    sessionLearning.skippedWords = Array.from(new Set([...sessionLearning.skippedWords, ...(data.duplicateSkippedWords ?? [])]))
    //如果 shuffle 数组不为空，就说明是复习，不用修改 lastLearnIndex
    if (settingStore.wordPracticeMode !== WordPracticeMode.Shuffle) {
      completeBookLearningTask(store.sdict, taskWords)
      // 检查已忽略的单词数量，是否全部完成
      let ignoreList = [store.allIgnoreWords, store.knownWords][settingStore.ignoreSimpleWord ? 0 : 1]
      // 忽略单词数
      const ignoreCount = ignoreList.filter(word =>
        store.sdict.words.slice(store.sdict.lastLearnIndex).some(w => w.word.toLowerCase() === word)
      ).length
      // 如果lastLearnIndex已经超过可学单词数，则判定完成
      if (!store.sdict.units?.length && store.sdict.lastLearnIndex + ignoreCount >= store.sdict.length) {
        store.sdict.complete = true
        store.sdict.lastLearnIndex = store.sdict.length
      }
    }

    }
    const skipped = new Set(data.duplicateSkippedWords ?? [])
    const learning = getBookLearning(store.sdict)
    const practiced = (store.sdict.units?.length ? [] : [...taskWords.new, ...taskWords.review])
      .map(item => normalizeLearningWord(item.word)).filter(key => key && !skipped.has(key) && !learning.masteredWords.includes(key))
    if (!freeSession) learning.learnedWords = Array.from(new Set([...learning.learnedWords, ...practiced]))
    if (!freeSession && store.sdict.units?.length && !taskWords.unitReview) {
      refreshUnitBookProgress(store.sdict, settingStore.ignoreSimpleWord ? store.allIgnoreWordsSet : store.knownWordsSet)
    }
    statStore.skippedWordNumber = skipped.size
    statStore.newWordNumber = taskWords.new.filter(item => !skipped.has(normalizeLearningWord(item.word))).length
    statStore.reviewWordNumber = taskWords.review.filter(item => !skipped.has(normalizeLearningWord(item.word))).length
    statStore.total = statStore.newWordNumber + statStore.reviewWordNumber
    for (const key of skipped) {
      delete data.wrongTimesMap[key]
      delete data.ratingMap[key]
    }
    statStore.wrong = data.allWrongWords.filter(key => !skipped.has(normalizeLearningWord(key))).length

    // 按统一有效时长分日生成 Statistics 记录。
    flushStatToStore(statStore.$state)

    for (const [word, wrongTimes] of Object.entries(freeSession ? {} : data.wrongTimesMap)) {
      if (!normalizeLearningWord(word)) continue
      let rating = data.ratingMap[word]
      if (rating !== undefined) {
        setWordCard(rating, word)
      } else {
        // 则根据错误次数生成评级
        setWordCard(getGradeByWrongTimes(wrongTimes), word, wrongTimes)
      }
    }

    if (AppEnv.CAN_REQUEST) {
      let res = await addStat({
        ...data,
        type: 'word',
        perDayStudyNumber: store.sdict.perDayStudyNumber,
        lastLearnIndex: store.sdict.lastLearnIndex,
        complete: store.sdict.complete,
      })
      if (!res.success) {
        Toast.error(res.msg)
      }
    }

    // Persist this marker in the same dictionary snapshot as statistics/progress.
    // A refresh during remote sync must not restore the already-settled local cache.
    learning.lastCompletedPracticeAt = statStore.startDate
    learning.completedPracticeByScope ??= {}
    learning.completedPracticeByScope[JSON.stringify([taskWords.unitId ?? '', freeSession ? 'free' : 'study'])] = statStore.startDate
    await dataSync.saveDictState(store.$state, { pullWhenRemoteNewer: false })
    await wordPersistence.clear(practiceDictId)
    taskSettled = true

    let trackData = {
      funSpend: Date.now() - start,
      name: store.sdict.name,
      spend: Number(statStore.spend / 1000 / 60).toFixed(1),
      index: store.sdict.lastLearnIndex,
      per: store.sdict.perDayStudyNumber,
      custom: store.sdict.custom,
      complete: store.sdict.complete,
      str: '',
    }
    trackData.str = `name:${trackData.name},per:${trackData.per},spend:${trackData.spend},index:${trackData.index},funSpend:${trackData.funSpend}`
    window.umami?.track('endStudyWord', trackData)
    settling = false
    runtimeStore.globalLoading = false
  }
}

function next(isTyping: boolean = true, ignoreLoop = false) {
  if (isTyping) duplicateUndo = null
  let temp = word.word.toLowerCase()
  let preTimes = data.wrongTimesMap[temp] ?? 0

  // 优化：为了加快流程，将一次拼写成功的单词移出错词列表，后续不再安排重复练习
  // 如果在拼写阶段，一次拼写成功，并且之前有错误记录的。将单词从错词列表里面移除
  if (settingStore.wordPracticeType === WordPracticeType.Spell && data.wrongTimes === 0 && preTimes) {
    let rIndex = data.wrongWords.findIndex(v => v.word.toLowerCase() === temp)
    if (rIndex >= 0) {
      data.wrongWords.splice(rIndex, 1)
    }
  }

  data.wrongTimesMap[temp] = preTimes + data.wrongTimes
  data.wrongTimes = 0

  // debugger
  if (isTyping) statStore.inputWordNumber++
  if (settingStore.wordPracticeMode === WordPracticeMode.Free) {
    if (data.index === data.words.length - 1) {
      data.wrongWords = data.wrongWords.filter(v => !data.excludeWords.includes(v.word))
      if (data.wrongWords.length) {
        data.isTypingWrongWord = true
        setPracticeType(WordPracticeType.FollowWrite)
        console.log('当前学完了，但还有错词')
        data.words = shuffle(cloneDeep(data.wrongWords))
        data.index = 0
        data.wrongWords = []
      } else {
        data.isTypingWrongWord = false
        complete()
      }
    } else {
      data.index++
    }
  } else {
    // 无词或已是最后一个词：走阶段推进/完成逻辑（nextStage 空列表时会把 words 清空，需一并处理）
    if (data.words.length === 0 || data.index === data.words.length - 1) {
      // 有词时才做「回到最后一组」等依赖当前词的处理；无词时直接走错词/阶段逻辑
      if (data.words.length) {
        if ((statStore.stage === WordPracticeStage.FollowWriteNewWord || data.isTypingWrongWord) && !ignoreLoop) {
          if (settingStore.wordPracticeType !== WordPracticeType.Spell) {
            //回到最后一组的开始位置
            data.index = Math.floor(data.index / groupSize) * groupSize
            emitter.emit(EventKey.resetWord)
            setPracticeType(WordPracticeType.Spell)
            if (checkWordIsNeedNext(word)) next(false, ignoreLoop)
            return
          }
        }
      }
      data.wrongWords = data.wrongWords.filter(v => !checkWordIsNeedNext(v))
      if (data.wrongWords.length) {
        data.isTypingWrongWord = true
        setPracticeType(WordPracticeType.FollowWrite)
        console.log('当前学完了，但还有错词')
        data.words = shuffle(cloneDeep(data.wrongWords))
        data.index = 0
        data.wrongWords = []
      } else {
        data.isTypingWrongWord = false
        console.log('当前学完了，没错词', statStore.total, statStore.stage, data.index)

        if (settingStore.wordPracticeMode === WordPracticeMode.System) {
          if (statStore.stage === WordPracticeStage.FollowWriteNewWord) {
            nextStage(shuffle(taskWords.new), '开始听写新词', true)
          } else if (statStore.stage === WordPracticeStage.ListenNewWord) {
            nextStage(shuffle(taskWords.new), '开始默写新词')
          } else if (statStore.stage === WordPracticeStage.DictationNewWord) {
            console.log('新词学习完成')
            nextStage(taskWords.review, '开始自测旧词')
          } else if (statStore.stage === WordPracticeStage.IdentifyReview) {
            nextStage(shuffle(taskWords.review), '开始听写旧词', true)
          } else if (statStore.stage === WordPracticeStage.ListenReview) {
            nextStage(shuffle(taskWords.review), '开始默写旧词')
          } else if (statStore.stage === WordPracticeStage.DictationReview) {
            complete()
          }
        } else if (settingStore.wordPracticeMode === WordPracticeMode.ListenOnly) {
          if (statStore.stage === WordPracticeStage.ListenNewWord) {
            nextStage(taskWords.review, '开始听写旧词', true)
          } else if (statStore.stage === WordPracticeStage.ListenReview) complete()
        } else if (settingStore.wordPracticeMode === WordPracticeMode.DictationOnly) {
          if (statStore.stage === WordPracticeStage.DictationNewWord) {
            nextStage(taskWords.review, '开始默写旧词', true)
          } else if (statStore.stage === WordPracticeStage.DictationReview) complete()
        } else if (settingStore.wordPracticeMode === WordPracticeMode.IdentifyOnly) {
          if (statStore.stage === WordPracticeStage.IdentifyNewWord) {
            nextStage(taskWords.review, '开始自测旧词')
          } else if (statStore.stage === WordPracticeStage.IdentifyReview) complete()
        } else if (settingStore.wordPracticeMode === WordPracticeMode.Shuffle) {
          if (statStore.stage === WordPracticeStage.Shuffle) complete()
        } else if (settingStore.wordPracticeMode === WordPracticeMode.Review) {
          if (statStore.stage === WordPracticeStage.IdentifyReview) {
            nextStage(shuffle(taskWords.review), '开始听写旧词', true)
          } else if (statStore.stage === WordPracticeStage.ListenReview) {
            nextStage(shuffle(taskWords.review), '开始默写旧词')
          } else if (statStore.stage === WordPracticeStage.DictationReview) complete()
        }
      }
    } else {
      if (statStore.stage === WordPracticeStage.FollowWriteNewWord) {
        wordLoop()
      } else {
        if (data.isTypingWrongWord) wordLoop()
        else data.index++
      }
    }
  }

  // 仅在有当前词列表时再检查是否需跳过当前词，避免 words 被清空后用默认 word 误触发 next
  if (data.words.length > 0 && checkWordIsNeedNext(word)) next(false, ignoreLoop)
}

//检查单词是否跳过
//如果单词是已掌握的/或者主动跳过的，则略过
function checkWordIsNeedNext(word: Word) {
  if (!word.word) return false
  let rIndex = data.excludeWords.findIndex(v => v === word.word)
  return isWordSimple(word) || rIndex > -1
}

async function skipStep() {
  if (skipStepRunning) return
  skipStepRunning = true
  try {
    if (statStore.nextStage !== WordPracticeStage.Complete) {
      const practiceData = cloneDeep(data)
      practiceData.question = null
      skipCheckpoint = {
        stage: statStore.stage,
        practiceType: activePracticeType,
        practiceData,
      }
    }

    isManualStageSkip = true
    try {
      data.index = data.words.length - 1
      data.wrongWords = []
      next(false, true)
    } finally {
      isManualStageSkip = false
    }

    if (skipCheckpoint) {
      Toast.success('已跳到下一阶段，可用左箭头撤销')
      await savePracticeData('skip-stage')
    }
  } finally {
    skipStepRunning = false
  }
}

async function undoSkipStep() {
  if (!skipCheckpoint) return
  const checkpoint = cloneDeep(skipCheckpoint)
  isRestoringSkipCheckpoint = true
  try {
    skipCheckpoint = null
    statStore.stage = checkpoint.stage
    data = getDefaultPracticeData(data, checkpoint.practiceData)
    setPracticeType(checkpoint.practiceType)
    watchPracticeType(checkpoint.practiceType)
    emitter.emit(EventKey.resetWord)
    await nextTick()
    await savePracticeDataIns('undo-skip-stage', true)
    Toast.success(`已返回${WordPracticeStageNameMap[checkpoint.stage]}`)
  } catch (error) {
    skipCheckpoint = checkpoint
    console.warn('撤销跳过保存失败', error)
    Toast.error('返回成功，但保存失败；请再次点击左箭头重试')
  } finally {
    isRestoringSkipCheckpoint = false
  }
}

function addExcludeWord() {
  //标记模式时，用户认识的单词加入到排除里面，后续不再复习
  let rIndex = data.excludeWords.findIndex(v => v === word.word)
  if (rIndex < 0) {
    data.excludeWords.push(word.word)
  }
}

function onWordKnow() {
  duplicateUndo = null
  //"我认识“强制更新了Good，因为点”已掌握“才会设置Easy
  if (
    resolveWordInputMode(settingStore, statStore.stage, settingStore.wordPracticeType) === WordInputMode.Whole
  ) {
    onWordRating(Rating.Good)
  } else {
    data.ratingMap[word.word.toLowerCase()] = Rating.Good
  }
  addExcludeWord()
}

function onWordRating(rating: Rating) {
  duplicateUndo = null
  const key = word.word.toLowerCase()
  const current = data.ratingMap[key]
  if (current === undefined || rating < current) {
    data.ratingMap[key] = rating
  }
}

function onTypeWrong() {
  duplicateUndo = null
  data.wrongTimes++
  //这里的代码暂时不能移动，因为要实时把错词加入到列表里面，从而更新toolbar里面的错词数
  //todo 后续可以优化
  let temp = word.word.toLowerCase()
  if (!data.allWrongWords.find(v => v === temp)) {
    data.allWrongWords.push(temp)
    statStore.wrong++
  }
  if (!store.wrong.words.find((v: Word) => v.word.toLowerCase() === temp)) {
    store.wrong.words.push(word)
    store.wrong.length = store.wrong.words.length
  }
  if (!data.wrongWords.find((v: Word) => v.word.toLowerCase() === temp)) {
    data.wrongWords.push(word)
  }
  let rIndex = data.excludeWords.findIndex(v => v === word.word)
  if (rIndex > -1) {
    data.excludeWords.splice(rIndex, 1)
  }
  savePracticeData('wrong')
}

//设置单词卡片
function setWordCard(rating: number, wordStr = word.word, times?: number) {
  wordStr = normalizeLearningWord(wordStr)
  let card = store.currentFsrsData[wordStr]
  if (!card) {
    card = createEmptyCard()
  }
  card = nextCard(card, rating)
  store.currentFsrsData[wordStr] = card
  // console.log(
  //   `更新卡片: 单词：${wordStr}, 模式：${WordPracticeType[settingStore.wordPracticeType]}, 评分: ${Rating[rating]}, 次数：${times}, 卡片: `,
  //   card,
  //   cloneDeep(store.fsrsData)
  // )
}

async function savePracticeDataIns(where?: string, force: boolean = false) {
  // 第一词和第一阶段也保存；尚未完成不等于尚未开始。
  if (resettingBookTask || isIniting.value || !data.words.length || isComplete || taskSettled) return
  // console.log('savePracticeData', where)
  syncPracticeTimer()
  await wordPersistence.save({
    dictId: practiceDictId,
    practiceType: activePracticeType,
    practiceMode: sessionMode,
    taskWords,
    practiceData: cloneDeep(data),
    statStoreData: cloneDeep(statStore.$state),
    skipCheckpoint,
  }, { unifiedTiming: true })
}

function savePracticeData(where?: string) {
  return savePracticeDataIns(where).catch(error => {
    console.warn('练习进度保存失败', error)
  })
}

function repeat() {
  if (settling) return
  console.log('重学一遍')
  wordPersistence.clear(practiceDictId)
  let temp = cloneDeep(taskWords)
  let ignoreSet = [store.allIgnoreWordsSet, store.knownWordsSet][settingStore.ignoreSimpleWord ? 0 : 1]
  //随机练习单独处理
  if (settingStore.wordPracticeMode === WordPracticeMode.Shuffle) {
    temp.review = shuffle(temp.review.filter(v => !ignoreSet.has(v.word)))
  } else {
    //将学习进度减回去
    if (!store.sdict.units?.length && settingStore.wordPracticeMode !== WordPracticeMode.Free) {
      store.sdict.lastLearnIndex = taskWords.startIndex ?? Math.max(0, store.sdict.lastLearnIndex - taskWords.new.length)
    } else if (isComplete) {
      temp.review = [...temp.new, ...temp.review]
      temp.new = []
      temp.unitScannedWords = []
      temp.unitReview = true
    }
    //排除已掌握单词
    temp.new = temp.new.filter(v => !ignoreSet.has(v.word))
    temp.review = temp.review.filter(v => !ignoreSet.has(v.word))
  }
  emitter.emit(EventKey.resetWord)
  initData(temp)
}

function prev() {
  if (data.index === 0) {
    Toast.warning('已经是第一个了~')
  } else {
    data.index--
  }
}

function skip() {
  if (
    resolveWordInputMode(settingStore, statStore.stage, settingStore.wordPracticeType) === WordInputMode.Whole
  ) {
    onWordRating(Rating.Again)
  }
  addExcludeWord()
  next(false)
}

function goToNextWord() {
  if (
    resolveWordInputMode(settingStore, statStore.stage, settingStore.wordPracticeType) ===
      WordInputMode.Whole &&
    !typingRef?.isWholeInputComplete?.()
  ) {
    onWordRating(Rating.Again)
  }
  next(false)
}

function show(e: KeyboardEvent) {
  typingRef.showWord()
}

function collect(e: KeyboardEvent) {
  const anchor = typingRef?.getCollectAnchor?.() as HTMLElement | null | undefined
  openWordCollectPicker(word, anchor ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 }, {
    excludeDictId: store.sdict.id ? String(store.sdict.id) : undefined,
  })
}

function play() {
  typingRef.play()
}

function toggleWordSimpleWrapper() {
  if (!isWordSimple(word)) {
    setTimeout(() => next(false))
  }
  toggleWordSimple(word)
  let rIndex = data.excludeWords.findIndex(v => v === word.word)
  if (rIndex > -1) {
    data.excludeWords.splice(rIndex, 1)
  } else {
    data.excludeWords.push(word.word)
  }
}

function toggleConciseMode() {
  settingStore.showToolbar = !settingStore.showToolbar
  settingStore.showPanel = settingStore.showToolbar
}

async function continueStudy() {
  if (settling) return
  if (settingStore.wordPracticeMode === WordPracticeMode.Free) { await router.push('/words'); return }
  if (store.sdict.units?.length) {
    if (!isComplete) {
      Toast.warning('请先完成本轮，再继续下一组或切换单元。')
      return
    }
    const ignored = settingStore.ignoreSimpleWord ? store.allIgnoreWordsSet : store.knownWordsSet
    if (taskWords.unitReview || !getUnitProgress(store.sdict, taskWords.unitId, ignored).remaining) {
      await router.push('/words')
      return
    }
  }
  const completed = isComplete
  await wordPersistence.clear(practiceDictId)
  if (store.sdict.library) Object.assign(store.sdict, await loadLibraryBook(store.sdict))
  let temp = cloneDeep(taskWords)
  let ignoreList = [store.allIgnoreWords, store.knownWords][settingStore.ignoreSimpleWord ? 0 : 1]
  //随机练习单独处理
  if (settingStore.wordPracticeMode === WordPracticeMode.Shuffle) {
    const ignoreSet = [store.allIgnoreWordsSet, store.knownWordsSet][settingStore.ignoreSimpleWord ? 0 : 1]
    temp.review = getShufflePracticeWords(
      store.sdict.words,
      {
        total: practiceRouteOptions?.total ?? temp.review.length,
        range: practiceRouteOptions?.shuffleRange ?? { start: 0, end: store.sdict.lastLearnIndex },
      },
      ignoreSet
    ).words
  } else {
    //这里判断是否显示结算弹框，如果显示了结算弹框的话，就不用加进度了
    if (!completed && !store.sdict.units?.length) {
      console.log('没学完，强行跳过')
      store.sdict.lastLearnIndex = taskWords.endIndex ?? (store.sdict.lastLearnIndex + taskWords.new.length)
      // 忽略单词数
      const ignoreCount = ignoreList.filter(word => store.sdict.words.some(w => w.word.toLowerCase() === word)).length
      // 如果lastLearnIndex已经超过可学单词数，则判定完成
      if (store.sdict.lastLearnIndex + ignoreCount >= store.sdict.length) {
        store.sdict.complete = true
        store.sdict.lastLearnIndex = store.sdict.length
      }
    } else {
      console.log('学完了，正常下一组')
    }

    temp = getCurrentStudyWord()
  }
  emitter.emit(EventKey.resetWord)
  initData(temp)

  if (AppEnv.CAN_REQUEST) {
    let res = await setUserDictProp(null, { ...store.sdict, type: 'word' })
    if (!res.success) {
      Toast.error(res.msg)
    }
  }
}

async function jumpToGroup(group: number) {
  if (settingStore.wordPracticeMode === WordPracticeMode.Free) { Toast.warning('自由练习不会改变正式学习进度。请返回首页选择范围。'); return }
  if (store.sdict.units?.length) {
    Toast.warning('单元学习请在首页选择 Lesson。')
    return
  }
  window?.umami?.track('jumpToGroup')
  wordPersistence.clear(practiceDictId)
  console.log('没学完，强行跳过', group)
  store.sdict.lastLearnIndex = (group - 1) * store.sdict.perDayStudyNumber
  emitter.emit(EventKey.resetWord)
  initData(getCurrentStudyWord())
  if (AppEnv.CAN_REQUEST) {
    let res = await setUserDictProp(null, { ...store.sdict, type: 'word' })
    if (!res.success) {
      Toast.error(res.msg)
    }
  }
}

function randomWrite() {
  window?.umami?.track('randomWrite')
  console.log('随机默写')
  data.words = shuffle(data.words)
  data.index = 0
  settingStore.dictation = true
}

useStartKeyboardEventListener({ beforeShortcut: handleDuplicateShortcut })
// useDisableEventListener(() => loading)

watch(isIniting, n => {
  if (!n) {
    watchRefList.map(v => v?.stop())
    watchRefList = [
      watch(
        () => statStore.stage,
        stage => {
          if (isIniting.value || isRestoringSkipCheckpoint) return
          watchStage(stage)
          void savePracticeData('stage')
        }
      ),
      watch(
        () => activePracticeType,
        practiceType => {
          if (isRestoringSkipCheckpoint) return
          watchPracticeType(practiceType)
          void savePracticeData('practice-type')
        }
      ),
      watch(
        () => data.index,
        () => {
          if (!isRestoringSkipCheckpoint) void savePracticeData('word-index')
        }
      ),
      // Delayed timer callbacks can cross the threshold without landing exactly on it.
      watch(
        () => statStore.spend,
        (curr, prev) => {
          if (crossedPracticeTimeSaveInterval(prev, curr)) {
            savePracticeData('spend')
          }
        }
      ),
    ]
  }
})

function onWordMarkPickComplete(result: WordMarkPickResult) {
  duplicateUndo = null
  const learning = getBookLearning(store.sdict)
  for (const item of result.skipped ?? []) {
    const key = normalizeLearningWord(item.word)
    if (!learning.skippedWords.includes(key)) learning.skippedWords.push(key)
    data.duplicateSkippedWords = Array.from(new Set([...(data.duplicateSkippedWords ?? []), key]))
    if (!data.excludeWords.includes(item.word)) data.excludeWords.push(item.word)
  }
  statStore.skippedWordNumber = data.duplicateSkippedWords?.length ?? 0

  result.know.map(word => {
    data.ratingMap[word.word.toLowerCase()] = Rating.Good
    data.excludeWords.push(word.word)
  })
  result.mastered.map(word => {
    if (!isWordSimple(word)) toggleWordSimple(word)
    data.excludeWords.push(word.word)
  })
  console.log(result)
  if (result.unknown.length > 0) {
    data.isTypingWrongWord = true
    setPracticeType(WordPracticeType.FollowWrite)
    console.log('当前学完了，但还有错词')
    data.words = shuffle(cloneDeep(result.unknown))
    data.index = 0
    data.wrongWords = []

    data.allWrongWords = data.allWrongWords.concat(result.unknown.map(v => v.word.toLowerCase()))
    result.unknown.forEach(v => {
      data.wrongTimesMap[v.word.toLowerCase()] = 1
    })
  } else {
    data.words = []
    next(false)
  }
}

useEvents([
  [EventKey.onTyping, () => { duplicateUndo = null; handleResumeTimer() }],
  [EventKey.repeatStudy, repeat],
  [EventKey.continueStudy, continueStudy],
  //当默写时，执行 show 会标记为错误，并更新卡片
  [ShortcutKey.ShowWord, throttle(show, 300)],
  [ShortcutKey.Previous, prev],
  [ShortcutKey.Next, throttle(goToNextWord, 300)],
  [ShortcutKey.Ignore, throttle(skip, 300)],
  [ShortcutKey.ToggleCollect, collect],
  [ShortcutKey.ToggleSimple, toggleWordSimpleWrapper],
  [ShortcutKey.PlayWordPronunciation, play],

  [ShortcutKey.RepeatChapter, repeat],
  [ShortcutKey.NextChapter, continueStudy],
  [ShortcutKey.NextStep, skipStep],
  [ShortcutKey.ToggleShowTranslate, () => (settingStore.translate = !settingStore.translate)],
  [ShortcutKey.ToggleDictation, () => (settingStore.dictation = !settingStore.dictation)],
  [ShortcutKey.ToggleTheme, toggleTheme],
  [ShortcutKey.ToggleConciseMode, toggleConciseMode],
  [ShortcutKey.ToggleToolbar, () => (settingStore.showToolbar = !settingStore.showToolbar)],
  [ShortcutKey.TogglePanel, () => (settingStore.showPanel = !settingStore.showPanel)],
  [ShortcutKey.RandomWrite, randomWrite],
])
</script>

<template>
  <PracticeLayout v-loading="loading" panelLeft="var(--word-panel-margin-left)">
    <template v-slot:practice>
      <div class="practice-word">
        <div class="fixed z-99999 center mt-3" v-if="statStore.timerPaused">
          <ToastComponent
            :duration="0"
            :anim="statStore.timerPauseReason !== 'auto_visibility'"
            :shadow="false"
            :showClose="true"
            :message="statStore.timerPauseReason === 'auto_idle' ? '已连续 3 分钟无键盘操作，计时已暂停' : '计时已暂停'"
            @close="handleResumeTimer"
          />
        </div>

        <WordMarkPickList
          v-if="
            settingStore.wordPracticeType === WordPracticeType.Identify &&
            data.wrongWords.length === 0 &&
            settingStore.identifyMethod === IdentifyMethod.QuickIdentify
          "
          :words="data.words"
          @complete="onWordMarkPickComplete"
        />

        <div class="mb-50 w-full" v-else>
          <!--        前后单词-->
          <div
            class="fixed z-1 top-4 w-full hidden md:block"
            style="left: calc(50vw + var(--aside-width) / 2 - var(--toolbar-width) / 2); width: var(--toolbar-width)"
            v-if="settingStore.showNearWord"
          >
            <Tooltip :title="`上一个(${settingStore.shortcutKeyMap[ShortcutKey.Previous]})`">
              <div class="relative z-2 center gap-2 cp float-left" @click="prev" v-if="prevWord">
                <IconFluentArrowLeft16Regular class="arrow" width="22" />
                <div class="word">{{ prevWord.word }}</div>
              </div>
            </Tooltip>

            <div
              class="center gap-1 absolute w-full cp"
              v-if="settingStore.showConflictNotice2"
              @click="showConflictNotice2 = true"
            >
              <IconFluentQuestionCircle20Regular />
              <span class="">无法输入？</span>
            </div>

            <Tooltip :title="`下一个(${settingStore.shortcutKeyMap[ShortcutKey.Next]})`">
              <div class="relative center gap-2 cp float-right mr-3" @click="goToNextWord" v-if="nextWord">
                <div class="word" :class="settingStore.dictation && 'word-shadow'">
                  {{ nextWord.word }}
                </div>
                <IconFluentArrowRight16Regular class="arrow" width="22" />
              </div>
            </Tooltip>
          </div>
          <TypeWord
            ref="typingRef"
            :word="word"
            :question="data.question"
            :initial-wrong-times="data.wrongTimes"
            :before-practice-shortcut="handleDuplicateShortcut"
            @wrong="onTypeWrong"
            @rating="onWordRating"
            @complete="next"
            @mastered="toggleWordSimpleWrapper"
            @know="onWordKnow"
            @skip="skip"
            @toggle-simple="toggleWordSimpleWrapper"
          >
            <template #learning-notice>
          <div v-if="duplicateSources.length && getBookLearning(store.sdict).duplicateMode !== 'off'" class="mt-4 mb-2 rounded-lg p-3 text-sm text-center" style="background: var(--bg-card-secend)" role="status">
            <div>你已在 {{ duplicateSourceLabel }} 学过此词，可以再背一次加深记忆。</div>
            <button type="button" class="mt-2 underline" @click="skipDuplicateWord()">跳过此词（{{ duplicateShortcutLabel }}）</button>
            <div class="text-xs mt-1 opacity-70">快捷键在尚未作答时生效；开始输入后仍可点此跳过。</div>
          </div>
          <div v-if="duplicateUndo && !isComplete" class="mt-3 text-sm text-center" role="status">
            已跳过重复词 {{ duplicateUndo.word }}
            <button type="button" class="ml-2 underline" @click="undoDuplicateSkip">撤销跳过</button>
          </div>
            </template>
          </TypeWord>
        </div>
      </div>
    </template>
    <template v-slot:panel>
      <Panel>
        <template v-slot:title>
          <div class="center gap-1">
            <span>{{ store.sdict.name }}</span>
            <span v-if="store.sdict.units?.length" class="text-sm opacity-70">{{ store.sdict.units.find(unit => unit.id === taskWords.unitId)?.name ?? '整本词书' }}</span>

            <GroupList
              @click="jumpToGroup"
              v-if="!store.sdict.units?.length && taskWords.new.length && settingStore.wordPracticeMode !== WordPracticeMode.Shuffle"
            />
            <BaseIcon
              v-if="
                taskWords.new.length &&
                !store.sdict.units?.length &&
                ![WordPracticeMode.Review, WordPracticeMode.Shuffle].includes(settingStore.wordPracticeMode)
              "
              @click="continueStudy"
              :title="`下一组(${settingStore.shortcutKeyMap[ShortcutKey.NextChapter]})`"
            >
              <IconFluentArrowRight16Regular class="arrow" width="22" />
            </BaseIcon>

            <BaseIcon @click="randomWrite" :title="`随机默写(${settingStore.shortcutKeyMap[ShortcutKey.RandomWrite]})`">
              <IconFluentArrowShuffle16Regular class="arrow" width="22" />
            </BaseIcon>
          </div>
        </template>
        <div class="panel-page-item pl-4">
          <WordList
            v-if="data.words.length"
            :is-active="settingStore.showPanel"
            :static="false"
            :show-word="!settingStore.dictation"
            :show-translate="settingStore.translate"
            :list="data.words"
            :activeIndex="data.index"
            :excludeWords="data.excludeWords"
            :exclude-dict-id="store.sdict.id ? String(store.sdict.id) : undefined"
            @click="(val: any) => (data.index = val.index)"
          >
          </WordList>
          <Empty v-else />
        </div>
      </Panel>
    </template>
    <template v-slot:footer>
      <Footer :canUndoSkipStep="!!skipCheckpoint" @skipStep="skipStep" @undoSkipStep="undoSkipStep" />
    </template>
  </PracticeLayout>
  <Statistics v-model="isComplete" :loading="settling" :can-undo-duplicate-skip="!!duplicateUndo" @undo-duplicate-skip="undoDuplicateSkip" />
  <ConflictNotice v-if="showConflictNotice" />
  <CollectNotice v-model="showCollectNotice" />
  <ConflictNotice2 v-model="showConflictNotice2" />
</template>

<style scoped lang="scss">
.practice-wrapper {
  @apply w-full h-full flex justify-center overflow-hidden;
}

.practice-word {
  @apply h-full flex flex-col justify-between items-center relative;
  width: var(--toolbar-width);
}

// 移动端适配
@media (max-width: 768px) {
  .practice-word {
    width: 100%;

    .absolute.z-1.top-4 {
      z-index: 100; // 提高层级，确保不被遮挡

      .center.gap-2.cursor-pointer {
        min-height: 44px;
        min-width: 44px;
        padding: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;

        .word {
          pointer-events: none; // 文字不拦截点击
        }

        .arrow {
          pointer-events: none; // 箭头图标不拦截点击
        }
      }
    }
  }
}

.word-panel-wrapper {
  position: absolute;
  left: var(--panel-margin-left);
  //left: 0;
  top: 0.8rem;
  z-index: 1;
  height: calc(100% - 1.5rem);
}
</style>
