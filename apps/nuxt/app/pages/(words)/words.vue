<script setup lang="ts">
import { useBaseStore } from '@typewords/core/stores/base.ts'
import { useRouter } from 'vue-router'
import {
  BaseButton,
  BaseIcon,
  BasePage,
  Calendar,
  Dialog,
  OptionButton,
  PopConfirm,
  Progress,
  Toast,
} from '@typewords/base'
import {
  _getAccomplishDate,
  _getDictDataByUrl,
  _nextTick,
  debounce,
  isMobile,
  loadJsLib,
  msToHourMinute,
  getShufflePracticeWords,
  resourceWrap,
  type ShufflePracticeSetting,
  total,
  useNav,
} from '@typewords/core/utils'
import type { Dict, DictResource } from '@typewords/core/types/types.ts'
import { provide, shallowReactive, watch } from 'vue'
import { getCurrentStudyWord } from '@typewords/core/hooks/dict.ts'
import { useRuntimeStore } from '@typewords/core/stores/runtime.ts'
import Book from '@typewords/core/components/Book.vue'
import { getDefaultDict } from '@typewords/core/types/func.ts'
import { DeleteIcon } from '@typewords/base'
import PracticeSettingDialog from '@typewords/core/components/word/PracticeSettingDialog.vue'
import ChangeLastPracticeIndexDialog from '@typewords/core/components/word/ChangeLastPracticeIndexDialog.vue'
import { useSettingStore } from '@typewords/core/stores/setting.ts'
import { useNow } from '@vueuse/core'
import { useWordCatalog } from '@typewords/core/composables/useWordCatalog.ts'
import { loadLibraryBook } from '@typewords/core/utils/libraryBooks.ts'
import {
  APP_NAME,
  AppEnv,
  DICT_LIST,
  LIB_JS_URL,
  Old_Host,
  Origin,
  TourConfig,
  WordPracticeModeNameMap,
  WordPracticeModeUrlMap,
} from '@typewords/core/config/env.ts'
import { myDictList } from '@typewords/core/apis'
import PracticeWordListDialog from '@typewords/core/components/word/PracticeWordListDialog.vue'
import ImportBanner from '@typewords/core/components/ImportBanner.vue'
import ReleaseBanner from '@typewords/core/components/ReleaseBanner.vue'
import ShufflePracticeSettingDialog from '@typewords/core/components/word/ShufflePracticeSettingDialog.vue'
import { deleteDict } from '@typewords/core/apis/dict.ts'
import { getBookLearning, getUnitProgress, getUnitWords, isFollowingStudyUnit } from '@typewords/core/utils/bookLearning.ts'
import BookLearningSettingsDialog from '@typewords/core/components/word/BookLearningSettingsDialog.vue'
import BookUnitPanel from '@typewords/core/components/word/BookUnitPanel.vue'
import { flushStatToStore, usePracticeWordPersistence } from '@typewords/core/composables/usePracticePersistence'
import { useDataSyncPersistence } from '@typewords/core/composables/useDataSyncPersistence'
import { bookPracticeSettingsKey } from '@typewords/core/composables/bookPracticeSettings.ts'
import { WordPracticeMode, WordPracticeStage } from '@typewords/core/types/enum.ts'
import { subscribePracticeWordCache, type PracticeWordCache, type PracticeWordCacheBundle } from '@typewords/core/utils/cache.ts'
import { collectStudyStatistics, type StudyStatisticsRow } from '@typewords/core/utils/studyStatistics.ts'
import dayjs from 'dayjs'

const store = useBaseStore()
const settingStore = useSettingStore()
const wordPersistence = usePracticeWordPersistence()
const dataSync = useDataSyncPersistence()
const router = useRouter()
const { nav } = useNav()
const runtimeStore = useRuntimeStore()
let loading = $ref(true)
let isSaveData = $ref(false)
let isSwitchingBook = $ref(false)
let isChangingUnit = $ref(false)
let isApplyingBookSettings = $ref(false)
let showBookLearningSettings = $ref(false)
let bookSwitchVersion = 0
const followsUnit = computed(() => isFollowingStudyUnit(store.sdict))

const shouldShowDialogPracticeMode = [WordPracticeMode.Shuffle, WordPracticeMode.ShuffleWordsTest]

useHead({
  title: APP_NAME + ' 单词',
})

function createEmptyPracticeData(): PracticeWordCache {
  return {
    taskWords: {
      new: [],
      review: [],
    },
    practiceData: null,
    statStoreData: null,
  } as any
}

let practiceData = $ref<PracticeWordCache>(createEmptyPracticeData())

let statisticsBundle = $ref<PracticeWordCacheBundle | null>(null)
let statisticsReadVersion = 0
async function refreshStatisticsBundle() {
  const version = ++statisticsReadVersion
  try {
    const bundle = await wordPersistence.getLocalDataCompact()
    if (version === statisticsReadVersion) statisticsBundle = bundle
  } catch (error) {
    console.warn('读取全部词书练习统计失败', error)
  }
}
let stopStatisticsSubscription = () => {}
const statisticsNow = useNow({ interval: 60_000 })

provide(bookPracticeSettingsKey, {
  dictId: () => String(store.sdict.id),
  snapshot: async () => {
    if (isSwitchingBook || isChangingUnit || isApplyingBookSettings) throw new Error('词书正在更新，请稍后重试。')
    return { cache: await wordPersistence.getLocalEntryCompact(String(store.sdict.id)) }
  },
  apply: async (saveSettings, rebuild) => {
    if (isSwitchingBook || isChangingUnit || isApplyingBookSettings) throw new Error('词书正在更新，请稍后重试。')
    isApplyingBookSettings = true
    bookSwitchVersion++
    try {
      await saveSettings()
      if (rebuild) {
        // Discard this unfinished round without recording it as a completed study session.
        await wordPersistence.clear(String(store.sdict.id))
        if (store.sdict.library) Object.assign(store.sdict, await loadLibraryBook(store.sdict))
        practiceData = createEmptyPracticeData()
        practiceData.taskWords = getCurrentStudyWord()
        isSaveData = false
      }
    } finally {
      isApplyingBookSettings = false
    }
  },
})

function restoreTaskUnit(cache: PracticeWordCache) {
  if (store.sdict.units?.length && typeof cache.taskWords.unitId === 'string') {
    getBookLearning(store.sdict).selectedUnitId = cache.taskWords.unitId
  }
}

async function resetCacheData() {
  isSaveData && flushStatToStore(practiceData.statStoreData)
  isSaveData = false
  practiceData.practiceData = null
  practiceData.statStoreData = null
  await wordPersistence.clear(String(store.sdict.id))
}

// runtimeStore.globalLoading练习界面，退出时会调用一个保存，可能会卡住。当调用完成再init
//  immediate: true 比 onUmMounted 先执行，只能延时执行
watch(
  [() => store.load, () => runtimeStore.globalLoading],
  debounce(([a, b]) => {
    if (a && !b) {
      init()
      _nextTick(async () => {
        const Shepherd = await loadJsLib('Shepherd', LIB_JS_URL.SHEPHERD)
        const tour = new Shepherd.Tour(TourConfig)
        tour.on('cancel', () => {
          localStorage.setItem('tour-guide', '1')
        })
        tour.addStep({
          id: 'step1',
          text: '点击这里选择一本词典开始学习',
          attachTo: {
            element: '#step1',
            on: 'bottom',
          },
          buttons: [
            {
              text: `下一步（1/${TourConfig.total}）`,
              action() {
                tour.next()
                router.push('/dict-list')
              },
            },
          ],
        })
        const r = localStorage.getItem('tour-guide')
        if (settingStore.first && !r && !isMobile()) tour.start()
      }, 500)
    }
  }),
  { immediate: true }
)

async function onvisibilitychange() {
  if (!document.hidden && !isApplyingBookSettings) {
    //当页面可见时，检查是否需要从远程拉取数据
    const dictId = String(store.sdict.id)
    const version = bookSwitchVersion
    const d = await wordPersistence.fetch(dictId)
    await refreshStatisticsBundle()
    // 可见性恢复期间用户可能已经切换词书，不能用旧词书的缓存覆盖当前任务。
    if (!isApplyingBookSettings && version === bookSwitchVersion && String(store.sdict.id) === dictId && d) {
      practiceData = d
      restoreTaskUnit(d)
      if (d.practiceMode !== undefined) settingStore.wordPracticeMode = d.practiceMode
      isSaveData = true
    }
  }
}

async function init() {
  if (isApplyingBookSettings) return
  await refreshStatisticsBundle()
  const version = bookSwitchVersion
  if (AppEnv.CAN_REQUEST) {
    let res = await myDictList({ type: 'word' })
    if (res.success && version === bookSwitchVersion) {
      store.setState(Object.assign(store.$state, res.data))
    }
  }

  document.removeEventListener('visibilitychange', onvisibilitychange)
  document.addEventListener('visibilitychange', onvisibilitychange)

  if (version !== bookSwitchVersion) {
    loading = false
    return
  }

  try {
  let studyIndex = store.word.studyIndex
  if (studyIndex >= 3) {
    if (!store.sdict.custom && (!store.sdict.words.length || store.sdict.library)) {
      let dict = await _getDictDataByUrl(store.sdict)
      if (version !== bookSwitchVersion) {
        loading = false
        return
      }
      Object.assign(store.word.bookList[studyIndex], dict)
      store.word.bookList[studyIndex].length = dict.words.length
      let s = store.word.bookList[studyIndex]
      if (s.lastLearnIndex > s.length) {
        store.word.bookList[studyIndex].lastLearnIndex = s.length
        store.word.bookList[studyIndex].complete = true
        await resetCacheData()
      }
    }
  }

  const dictId = String(store.sdict.id)
  if (store.sdict.words.length) {
    const bookMode = getBookLearning(store.sdict).practiceMode
    if (bookMode !== undefined) settingStore.wordPracticeMode = bookMode
    const d = await wordPersistence.loadLocal(dictId)
    // init 可能与首页切换并发；只更新启动时同一本词书的界面数据。
    if (version !== bookSwitchVersion || String(store.sdict.id) !== dictId) {
      loading = false
      return
    }
    if (d) {
      practiceData = d
      restoreTaskUnit(d)
      if (d.practiceMode !== undefined) settingStore.wordPracticeMode = d.practiceMode
      isSaveData = true
    } else {
      practiceData = createEmptyPracticeData()
      practiceData.taskWords = getCurrentStudyWord()
      isSaveData = false
    }
  }
  } catch (error) {
    Toast.error(error instanceof Error ? error.message : '词书加载失败，请稍后重试')
  } finally { loading = false }
}

const learningBooks = $computed(() => store.word.bookList.filter(book => !!book.id && !book.system))
const unitIgnoredWords = $computed(() => new Set<string>(settingStore.ignoreSimpleWord ? store.simpleWords.map(word => word.trim().toLowerCase()) : []))

function getBookLength(book: Dict) {
  return Number(book.length) || book.words?.length || 0
}

function getBookProgress(book: Dict) {
  const length = getBookLength(book)
  if (!length) return 0
  if (book.units?.length) {
    const progress = getUnitProgress(book, '', unitIgnoredWords)
    return progress.total ? Math.round(progress.handled / progress.total * 100) : 0
  }
  return Math.min(100, Math.round((Math.max(0, Number(book.lastLearnIndex) || 0) / length) * 100))
}

function getBookProgressLabel(book: Dict) {
  if (book.complete) return '已学完'
  if (book.units?.length) return `已处理 ${getBookProgress(book)}%`
  if (!(Number(book.lastLearnIndex) || 0)) return '尚未开始'
  return `已学 ${getBookProgress(book)}%`
}

async function switchLearningBook(book: Dict) {
  if (isApplyingBookSettings || isSwitchingBook || isChangingUnit || String(book.id) === String(store.sdict.id)) return

  const version = ++bookSwitchVersion
  isSwitchingBook = true
  try {
    // 官方词书在未选中时会卸载单词正文；先补回目标词书，再交给 store 切换当前词书。
    if (!book.custom && (!book.words.length || book.library)) {
      const loadedBook = await _getDictDataByUrl(book)
      if (version !== bookSwitchVersion) return
      Object.assign(book, loadedBook)
    }

    if (!book.words.length) {
      Toast.warning('这本词书没有单词可学习')
      return
    }

    await store.changeDict(book)
    if (version !== bookSwitchVersion || String(store.sdict.id) !== String(book.id)) return

    // loadLocal 会先等待该词书的本地写入队列。未开始的词书只生成自己的新任务，绝不清除其他词书缓存。
    const cached = await wordPersistence.loadLocal(String(book.id))
    if (version !== bookSwitchVersion || String(store.sdict.id) !== String(book.id)) return

    const bookMode = getBookLearning(store.sdict).practiceMode
    if (bookMode !== undefined) settingStore.wordPracticeMode = bookMode
    practiceData = cached ?? createEmptyPracticeData()
    if (cached) {
      restoreTaskUnit(cached)
      if (cached.practiceMode !== undefined) settingStore.wordPracticeMode = cached.practiceMode
      isSaveData = true
    } else {
      practiceData.taskWords = getCurrentStudyWord()
      isSaveData = false
    }
  } catch (error) {
    console.error('切换词书失败', error)
    Toast.error(error instanceof Error ? error.message : '词书加载失败，请稍后重试')
  } finally {
    if (version === bookSwitchVersion) isSwitchingBook = false
  }
}

async function startPractice(practiceMode: WordPracticeMode, resetCache: boolean = false): Promise<void> {
  if (isApplyingBookSettings || isSwitchingBook || isChangingUnit) return
  if (resetCache) await resetCacheData()

  if (shouldShowDialogPracticeMode.includes(practiceMode) && !isSaveData) {
    editingWordPracticeMode = practiceMode
    showShufflePracticeSettingDialog = true
    return
  }

  if (store.sdict.id) {
    if (!resetCache && isSaveData) {
      const latest = await wordPersistence.loadLocal(String(store.sdict.id))
      if (latest) practiceData = latest
    }
    if (!store.sdict.words.length) {
      Toast.warning('没有单词可学习！')
      return
    }

    settingStore.wordPracticeMode = practiceMode

    window.umami?.track('startStudyWord', {
      name: store.sdict.name,
      index: store.sdict.lastLearnIndex,
      perDayStudyNumber: store.sdict.perDayStudyNumber,
      custom: store.sdict.custom,
      complete: store.sdict.complete,
      wordPracticeMode: settingStore.wordPracticeMode,
    })
    //把是否是第一次设置为false
    if (settingStore.first) settingStore.first = false
    nav(WordPracticeModeUrlMap[practiceMode] + '/' + store.sdict.id, {}, { ...practiceData, dictId: String(store.sdict.id) })
  } else {
    window.umami?.track('no-dict')
    Toast.warning('请先选择一本词典')
  }
}

async function freePractice() {
  if (isApplyingBookSettings || isSwitchingBook || isChangingUnit) return
  const freePersistence = usePracticeWordPersistence({ free: () => true })
  const cache = await freePersistence.loadLocal(String(store.sdict.id))
  const unitId = getBookLearning(store.sdict).selectedUnitId ?? ''
  const freeData = cache ?? createEmptyPracticeData()
  if (!cache) freeData.taskWords = { new: [], review: getUnitWords(store.sdict, unitId), unitId, unitReview: true }
  if (!freeData.taskWords.review.length && !freeData.taskWords.new.length) return Toast.warning('当前范围没有可练习的词。')
  settingStore.wordPracticeMode = WordPracticeMode.Free
  settingStore.first = false
  nav(WordPracticeModeUrlMap[WordPracticeMode.Free] + '/' + store.sdict.id, {}, { ...freeData, practiceMode: WordPracticeMode.Free, dictId: String(store.sdict.id) })
}

function systemPractice() {
  startPractice(
    settingStore.wordPracticeMode === WordPracticeMode.Free ? WordPracticeMode.System : settingStore.wordPracticeMode,
    settingStore.wordPracticeMode === WordPracticeMode.Free
  )
}

let editingWordPracticeMode = $ref(0)

let showPracticeSettingDialog = $ref(false)
let showShufflePracticeSettingDialog = $ref(false)
let showChangeLastPracticeIndexDialog = $ref(false)
let showPracticeWordListDialog = $ref(false)

type StudyDayRow = StudyStatisticsRow

let showStudyDayDialog = $ref(false)
let selectedStudyDateKey = $ref('')
let studyDayRecords = $ref<StudyDayRow[]>([])

const allWordStatistics = $computed(() => collectStudyStatistics(store.word.bookList, statisticsBundle, WordPracticeStage.Complete))

const calendarHighlightDates = $computed(() => {
  const set = new Set<string>()
  for (const s of allWordStatistics) {
    set.add(dayjs(s.startDate).format('YYYY-MM-DD'))
  }
  return [...set]
})

const totalSpend = $computed(() => {
  const sum = total(allWordStatistics, 'spend')
  if (!sum) return 0
  return msToHourMinute(sum)
})

const todayTotalSpend = $computed(() => {
  const todayPersistedMs = total(
    allWordStatistics.filter(v => dayjs(v.startDate).isSame(dayjs(statisticsNow.value), 'day')),
    'spend'
  )
  const sum = todayPersistedMs
  if (!sum) return 0
  return msToHourMinute(sum)
})

const totalDay = $computed(() => {
  const set = new Set(allWordStatistics.map(v => dayjs(v.startDate).format('YYYY-MM-DD')))
  return set.size
})

const studyDayDialogTitle = $computed(() =>
  selectedStudyDateKey ? `${dayjs(selectedStudyDateKey).format('YYYY年M月D日')} 学习记录` : ''
)

function onSelectCalendarDate(dateKey: string) {
  selectedStudyDateKey = dateKey
  const rows = allWordStatistics.filter(stat => dayjs(stat.startDate).format('YYYY-MM-DD') === dateKey)
  if (!rows.length) return Toast.info('无学习记录')
  studyDayRecords = rows
  showStudyDayDialog = true
}

async function goDictDetail(val: DictResource) {
  if (!val.id) return nav('dict-list')
  runtimeStore.editDict = getDefaultDict(store.word.bookList.find(book => String(book.id) === String(val.id)) ?? val)
  nav('/dict', {})
}

let isManageDict = $ref(false)
let selectIds = $ref([])

async function handleBatchDel() {
  if (AppEnv.CAN_REQUEST) {
    let res = await deleteDict(null, selectIds)
    if (res.success) {
      init()
    } else {
      Toast.error(res.msg)
    }
  } else {
    selectIds.forEach(id => {
      let r = store.word.bookList.findIndex(v => v.id === id)
      if (r !== -1) {
        if (store.word.studyIndex === r) {
          store.word.studyIndex = -1
        }
        if (store.word.studyIndex > r) {
          store.word.studyIndex--
        }
        store.word.bookList.splice(r, 1)
      }
    })
    selectIds = []
    Toast.success('删除成功！')
  }
}

function toggleSelect(item) {
  let rIndex = selectIds.findIndex(v => v === item.id)
  if (rIndex > -1) {
    selectIds.splice(rIndex, 1)
  } else {
    selectIds.push(item.id)
  }
}

const progressTextLeft = $computed(() => {
  if (store.sdict.complete) return '已学完，进入总复习阶段'
  return '当前进度：已学' + store.currentStudyProgress + '%'
})

function check(cb: Function) {
  if (!store.sdict.id) {
    Toast.warning('请先选择一本词典')
  } else {
    runtimeStore.editDict = getDefaultDict(store.sdict)
    cb()
  }
}

async function onBookSettingsSaved() {
  isSwitchingBook = true
  try {
  const cache = await wordPersistence.loadLocal(String(store.sdict.id))
  practiceData = cache ?? createEmptyPracticeData()
  isSaveData = !!cache
  if (cache?.practiceMode !== undefined) settingStore.wordPracticeMode = cache.practiceMode
  if (!cache) practiceData.taskWords = getCurrentStudyWord()
  } finally { isSwitchingBook = false }
}

async function reviewCurrentUnit() {
  if (isApplyingBookSettings || isSaveData || isChangingUnit || isSwitchingBook) return
  const cache = await wordPersistence.loadLocal(String(store.sdict.id))
  if (cache) {
    practiceData = cache
    isSaveData = true
    Toast.warning('请先继续并完成当前一轮。')
    return
  }
  const unitId = getBookLearning(store.sdict).selectedUnitId
  if (!unitId) return
  const ignoreSet = settingStore.ignoreSimpleWord ? store.allIgnoreWordsSet : store.knownWordsSet
  const review = getUnitWords(store.sdict, unitId).filter(word => !ignoreSet.has(word.word.trim().toLowerCase()))
  if (!review.length) return Toast.warning('本单元没有可重练的词。')
  practiceData = createEmptyPracticeData()
  practiceData.taskWords = { new: [], review, unitId, unitReview: true, unitScannedWords: [] }
  await startPractice(WordPracticeMode.Review)
}

async function savePracticeSetting() {
  await resetCacheData()
  await store.changeDict(runtimeStore.editDict)
  practiceData.taskWords = getCurrentStudyWord()
  Toast.success('修改成功')
}

async function onShufflePracticeSettingOk(setting: ShufflePracticeSetting) {
  await dataSync.saveDictState()
  await resetCacheData()
  settingStore.wordPracticeMode = editingWordPracticeMode

  window.umami?.track('startStudyWord', {
    name: store.sdict.name,
    index: store.sdict.lastLearnIndex,
    perDayStudyNumber: store.sdict.perDayStudyNumber,
    custom: store.sdict.custom,
    complete: store.sdict.complete,
    wordPracticeMode: settingStore.wordPracticeMode,
  })

  let ignoreSet = [store.allIgnoreWordsSet, store.knownWordsSet][settingStore.ignoreSimpleWord ? 0 : 1]
  const result = getShufflePracticeWords(store.sdict.words, setting, ignoreSet)
  practiceData.taskWords.review = result.words
  nav(
    WordPracticeModeUrlMap[editingWordPracticeMode] + '/' + store.sdict.id,
    {},
    {
      ...practiceData,
      total: result.words.length, //用于再来一组时，随机出正确的长度，因为练习中可能会点击已掌握，导致重学一遍之后长度变少，如果再来一组，此时长度就不正确
      shuffleRange: result.range,
    }
  )
}

async function saveLastPracticeIndex(e) {
  if (store.sdict.units?.length) return
  runtimeStore.editDict.lastLearnIndex = e
  // runtimeStore.editDict.complete = e >= runtimeStore.editDict.length - 1
  showChangeLastPracticeIndexDialog = false
  await resetCacheData()
  await store.changeDict(runtimeStore.editDict)
  practiceData.taskWords = getCurrentStudyWord()
  Toast.success('修改成功')
}

const { data: recommendDictList, isFetching } = useWordCatalog(true)

const systemPracticeText = $computed(() => {
  if (settingStore.wordPracticeMode === WordPracticeMode.Free) {
    return '开始学习'
  } else {
    return isSaveData
      ? '继续' + WordPracticeModeNameMap[settingStore.wordPracticeMode]
      : '开始' + WordPracticeModeNameMap[settingStore.wordPracticeMode]
  }
})

let isOldHost = $ref(false)
onMounted(() => {
  isOldHost = window.location.host === Old_Host
  stopStatisticsSubscription = subscribePracticeWordCache(() => { void refreshStatisticsBundle() })
  void refreshStatisticsBundle()
})

onUnmounted(() => {
  stopStatisticsSubscription()
  statisticsReadVersion++
  document.removeEventListener('visibilitychange', onvisibilitychange)
})
</script>

<template>
  <BasePage>
    <ReleaseBanner />

    <div class="my-100 text-4xl font-bold text-red" v-if="isOldHost">
      已启用新域名
      <a class="mr-4" :href="`${Origin}/words?from_old_site=1`">{{ Origin }}</a
      >当前 2study.top 域名将在 7 月 3 号停止使用
    </div>

    <section v-if="learningBooks.length" class="card mb-4 p-4 md:p-5" aria-labelledby="learning-books-title">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h2 id="learning-books-title" class="title mb-0">正在学习的词书</h2>
        <span v-if="isSwitchingBook" class="text-sm color-gray-500" role="status">正在切换…</span>
      </div>
      <div class="flex gap-3 overflow-x-auto pb-1" aria-label="切换正在学习的词书">
        <button
          v-for="book in learningBooks"
          :key="String(book.id)"
          type="button"
          class="learning-book-card shrink-0 text-left"
          :class="String(book.id) === String(store.sdict.id) && 'is-selected'"
          :aria-pressed="String(book.id) === String(store.sdict.id)"
          :disabled="isSwitchingBook || isChangingUnit"
          @click="switchLearningBook(book)"
        >
          <span class="block font-semibold truncate">{{ book.name }}</span>
          <span class="block text-xs color-gray-500 mt-1">{{ getBookProgressLabel(book) }}</span>
          <span class="block text-xs color-gray-500 mt-1">{{ book.units?.length ? getUnitProgress(book, '', unitIgnoredWords).handled : book.lastLearnIndex }} / {{ getBookLength(book) }} 词</span>
          <span class="learning-book-progress mt-2" aria-hidden="true">
            <span :style="{ width: `${getBookProgress(book)}%` }"></span>
          </span>
        </button>
      </div>
    </section>

    <BookUnitPanel :disabled="isSwitchingBook || isApplyingBookSettings" @changed="onBookSettingsSaved" @review="reviewCurrentUnit" @busy="isChangingUnit = $event" />

    <div class="card flex flex-col md:flex-row gap-4">
      <div class="flex-1 flex flex-col justify-between">
        <div class="flex gap-3">
          <div class="p-1 center rounded-full bg-white">
            <IconFluentBookNumber20Filled class="text-xl color-link" />
          </div>
          <div @click="goDictDetail(store.sdict)" class="text-2xl font-bold cursor-pointer">
            {{ store.sdict.name || $t('no_dict_selected') }}
          </div>
        </div>

        <template v-if="store.sdict.id">
          <div class="mt-4 space-y-2">
            <div class="text-sm flex justify-between">
              <span v-opacity="store.sdict.id && !followsUnit && store.sdict.lastLearnIndex < store.sdict.length">
                {{ $t('estimated_completion') }}：{{
                  _getAccomplishDate(
                    store.sdict.words.length - store.currentStudyHandledCount,
                    store.sdict.perDayStudyNumber
                  )
                }}
              </span>
            </div>
            <Progress size="large" :percentage="store.currentStudyProgress" :show-text="false"></Progress>

            <div class="text-sm flex justify-between">
              <span>{{ progressTextLeft }}</span>
              <span> {{ store.sdict.units?.length ? '已处理 ' : '' }}{{ store.currentStudyHandledCount }} / {{ store.sdict.length }} 词</span>
            </div>
          </div>
          <div class="flex items-center mt-4 gap-4">
            <BaseButton type="info" size="small" @click="router.push('/dict-list')">
              <div class="center gap-1">
                <IconFluentArrowSwap20Regular />
                <span>更多词书</span>
              </div>
            </BaseButton>
            <BaseButton type="info" size="small" @click="showBookLearningSettings = true">
              当前词书设置
            </BaseButton>
            <PopConfirm
              v-if="!store.sdict.units?.length"
              :disabled="!isSaveData"
              title="当前存在未完成的学习任务，修改会重新生成学习任务，是否继续？"
              @confirm="check(() => (showChangeLastPracticeIndexDialog = true))"
            >
              <BaseButton type="info" size="small" v-if="store.sdict.id">
                <div class="center gap-1">
                  <IconFluentSlideTextTitleEdit20Regular />
                  <span>{{ $t('change_progress') }}</span>
                </div>
              </BaseButton>
            </PopConfirm>

            <BaseButton type="info" size="small" @click="router.push('/fsrs')"> 学习记录</BaseButton>
          </div>
        </template>

        <div class="flex items-center gap-4 mt-2 flex-1" v-else>
          <div class="title">{{ $t('select_dict_to_start') }}</div>
          <BaseButton id="step1" type="primary" size="large" @click="router.push('/dict-list')">
            <div class="center gap-1">
              <IconFluentAdd16Regular />
              <span>添加词书</span>
            </div>
          </BaseButton>
        </div>
      </div>
      <div class="flex-1 mt-4 md:mt-0" :class="!store.sdict.id && 'opacity-30 cursor-not-allowed'">
        <div class="flex flex-wrap gap-3 justify-between">
          <div class="flex items-center gap-2">
            <div class="p-2 center rounded-full bg-white">
              <IconFluentStar20Filled class="text-lg color-amber" />
            </div>
            <div class="text-xl font-bold">
              {{ isSaveData ? $t('last_task') : $t('today_task') }}
            </div>
            <span class="color-link cursor-pointer" v-if="store.sdict.id" @click="showPracticeWordListDialog = true">{{
              $t('word_list')
            }}</span>
          </div>
          <div class="flex gap-1 items-center" v-if="store.sdict.id">
            每轮新词
            <div style="color: #ac6ed1" class="bg-third px-2 h-10 flex center text-2xl rounded">
              {{ followsUnit ? '跟随单元' : store.sdict.perDayStudyNumber }}
            </div>
            <span v-if="!followsUnit">{{ $t('words_count') }}</span>
            <BaseButton type="info" size="small" :disabled="isSwitchingBook" @click="showBookLearningSettings = true">{{ $t('change') }}</BaseButton>
          </div>
        </div>
        <div class="flex mt-4 justify-between">
          <div class="stat">
            <div class="num">{{ practiceData?.taskWords?.new?.length }}</div>
            <div class="txt">{{ $t('new_words') }}</div>
          </div>
          <div class="stat">
            <div class="num">{{ practiceData?.taskWords?.review?.length }}</div>
            <div class="txt">{{ $t('review') }}</div>
          </div>
        </div>
        <div class="flex items-end mt-4 gap-4 btn-no-margin">
          <OptionButton
            :class="settingStore.wordPracticeMode !== WordPracticeMode.Free ? 'flex-1 orange-btn' : 'primary-btn'"
          >
            <BaseButton
              size="large"
              :type="settingStore.wordPracticeMode !== WordPracticeMode.Free ? 'orange' : 'primary'"
              :disabled="!store.sdict.id || isSwitchingBook || isChangingUnit"
              :loading="loading"
              @click="systemPractice"
            >
              <div class="flex items-center gap-2">
                <span class="line-height-[2]">{{ systemPracticeText }}</span>
                <IconFluentArrowCircleRight16Regular class="text-xl" />
              </div>
            </BaseButton>
            <template #options>
              <BaseButton
                class="w-full"
                v-if="
                  settingStore.wordPracticeMode !== WordPracticeMode.System &&
                  settingStore.wordPracticeMode !== WordPracticeMode.Free
                "
                @click="startPractice(WordPracticeMode.System, true)"
              >
                {{ $t('smart_learning') }}
              </BaseButton>

              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.Review"
                :disabled="!practiceData?.taskWords?.review?.length"
                @click="startPractice(WordPracticeMode.Review, true)"
              >
                {{ $t('review') }}
              </BaseButton>
              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.Shuffle"
                :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete"
                @click="startPractice(WordPracticeMode.Shuffle, true)"
              >
                {{ $t('random_review') }}
              </BaseButton>
              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.ReviewWordsTest"
                :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete"
                @click="startPractice(WordPracticeMode.ReviewWordsTest, true)"
              >
                {{ $t('words') }}{{ $t('test') }}
              </BaseButton>
              <BaseButton
                class="w-full"
                v-if="settingStore.wordPracticeMode !== WordPracticeMode.ShuffleWordsTest"
                :disabled="store.sdict.lastLearnIndex < 10 && !store.sdict.complete"
                @click="startPractice(WordPracticeMode.ShuffleWordsTest, true)"
              >
                {{ $t('random_words_test') }}
              </BaseButton>

              <!--              <BaseButton-->
              <!--                class="w-full"-->
              <!--                v-if="settingStore.wordPracticeMode !== WordPracticeMode.IdentifyOnly"-->
              <!--                @click="startPractice(WordPracticeMode.IdentifyOnly, true)"-->
              <!--              >-->
              <!--                {{ WordPracticeModeNameMap[WordPracticeMode.IdentifyOnly] }}-->
              <!--              </BaseButton>-->
              <!--              <BaseButton-->
              <!--                class="w-full"-->
              <!--                v-if="settingStore.wordPracticeMode !== WordPracticeMode.ListenOnly"-->
              <!--                @click="startPractice(WordPracticeMode.ListenOnly, true)"-->
              <!--              >-->
              <!--                {{ WordPracticeModeNameMap[WordPracticeMode.ListenOnly] }}-->
              <!--              </BaseButton>-->
              <!--              <BaseButton-->
              <!--                class="w-full"-->
              <!--                v-if="settingStore.wordPracticeMode !== WordPracticeMode.DictationOnly"-->
              <!--                @click="startPractice(WordPracticeMode.DictationOnly, true)"-->
              <!--              >-->
              <!--                {{ WordPracticeModeNameMap[WordPracticeMode.DictationOnly] }}-->
              <!--              </BaseButton>-->
            </template>
          </OptionButton>

          <BaseButton
            :class="settingStore.wordPracticeMode === WordPracticeMode.Free ? 'flex-1' : ''"
            :type="settingStore.wordPracticeMode === WordPracticeMode.Free ? 'orange' : 'primary'"
            size="large"
            :loading="loading"
            @click="freePractice()"
          >
            <div class="flex items-center gap-2">
              <span class="line-height-[2]">
                {{
                  settingStore.wordPracticeMode === WordPracticeMode.Free && isSaveData
                    ? $t('continue_free_practice')
                    : $t('free_practice')
                }}
              </span>
              <IconStreamlineColorPenDrawFlat class="text-xl" />
            </div>
          </BaseButton>
        </div>
      </div>
    </div>

    <div class="card flex flex-col md:flex-row gap-4 xl:gap-20 p-4 md:p-6">
      <div class="flex-1 flex flex-col gap-3 min-w-0">
        <div class="title">统计</div>
        <div class="flex gap-3 items-center w-full">
          <div class="stat2">
            <div class="num">{{ todayTotalSpend }}</div>
            <div class="txt">{{ $t('today_study_time') }}</div>
          </div>
          <div class="stat2">
            <div class="num">{{ totalDay }}</div>
            <div class="txt">{{ $t('total_study_days') }}</div>
          </div>
          <div class="stat2">
            <div class="num">{{ totalSpend }}</div>
            <div class="txt">{{ $t('total_study_time') }}</div>
          </div>
        </div>
      </div>
      <div class="shrink-0 flex items-center">
        <Calendar
          :highlighted-dates="calendarHighlightDates"
          @select-date="onSelectCalendarDate"
          :weekHeaderTitle="$t('this_week_record')"
        >
        </Calendar>
      </div>
    </div>

    <ImportBanner
      title="导入自己的单词"
      desc="支持 txt/json/xlsx 文件导入，或者手动输入单词导入"
      @click="nav('/import', { type: 'word' })"
    />

    <div class="card flex flex-col">
      <div class="flex justify-between">
        <div class="title">{{ $t('my_dictionaries') }}</div>
        <div class="flex gap-4 items-center">
          <PopConfirm title="确认删除所有选中词典？" @confirm="handleBatchDel" v-if="selectIds.length">
            <BaseIcon class="del" :title="$t('delete')">
              <DeleteIcon />
            </BaseIcon>
          </PopConfirm>

          <div
            class="color-link cursor-pointer"
            v-if="store.word.bookList.length > 3"
            @click="
              () => {
                isManageDict = !isManageDict
                selectIds = []
              }
            "
          >
            {{ isManageDict ? $t('cancel') : $t('manage_dict') }}
          </div>
          <div class="color-link cursor-pointer" @click="nav('/dict', { isAdd: true })">
            {{ $t('create_personal_dict') }}
          </div>
        </div>
      </div>
      <div class="flex gap-4 flex-wrap mt-4">
        <Book
          :is-add="false"
          quantifier="词"
          :item="item"
          :checked="selectIds.includes(item.id)"
          @check="() => toggleSelect(item)"
          :show-checkbox="isManageDict && j >= 3"
          v-for="(item, j) in store.word.bookList"
          @click="goDictDetail(item)"
        />
        <Book :is-add="true" @click="router.push('/dict-list')" />
      </div>
    </div>

    <div class="card flex flex-col overflow-hidden" v-loading="isFetching">
      <div class="flex justify-between">
        <div class="title">{{ $t('recommend') }}</div>
        <div class="flex gap-4 items-center">
          <div class="color-link cursor-pointer" @click="router.push('/dict-list')">{{ $t('more') }}</div>
        </div>
      </div>

      <div class="flex gap-4 flex-wrap mt-4 min-h-50">
        <Book
          :is-add="false"
          quantifier="词"
          :item="item as any"
          v-for="(item, j) in recommendDictList"
          @click="goDictDetail(item as any)"
        />
      </div>
    </div>
  </BasePage>

  <PracticeSettingDialog
    :show-left-option="false"
    v-model="showPracticeSettingDialog"
    :onConfirm="savePracticeSetting"
  />

  <ChangeLastPracticeIndexDialog v-model="showChangeLastPracticeIndexDialog" @ok="saveLastPracticeIndex" />

  <PracticeWordListDialog :data="practiceData?.taskWords" v-model="showPracticeWordListDialog" />

  <ShufflePracticeSettingDialog
    v-model="showShufflePracticeSettingDialog"
    :onConfirm="onShufflePracticeSettingOk"
    :wordPracticeMode="editingWordPracticeMode"
  />

  <BookLearningSettingsDialog v-model="showBookLearningSettings" />

  <Dialog v-model="showStudyDayDialog" :title="studyDayDialogTitle" :footer="false" :padding="true">
    <div
      v-if="!studyDayRecords.length"
      class="text-gray-500 py-6 text-center"
    >
      当日无学习记录
    </div>
    <ul v-if="studyDayRecords.length" class="study-day-list max-h-70vh overflow-y-auto space-y-3">
      <li v-for="(row, idx) in studyDayRecords" :key="idx" class="border-b border-gray-200 pb-3 last:border-0">
        <div class="flex items-center gap-2">
          <span class="font-medium">{{ row.dictName }}</span>
          <span v-if="row.pending" class="text-xs text-gray-500">未完成练习</span>
          <span
            v-if="row.sessionRole && row.sessionRole !== 'single'"
            class="text-xs px-1.5 py-0.5 rounded-full"
            :class="{
              'bg-green-100 text-green-700': row.sessionRole === 'start',
              'bg-blue-100 text-blue-700': row.sessionRole === 'middle',
              'bg-orange-100 text-orange-700': row.sessionRole === 'end',
            }"
          >
            {{ { start: '学习开始', middle: '学习中', end: '学习结束' }[row.sessionRole] }}
          </span>
        </div>
        <div class="text-sm text-gray-600 mt-1">
          当日时长 {{ msToHourMinute(row.spend) }} · 本轮新词 {{ row.new }} · 本轮复习 {{ row.review }} · 本轮错词 {{ row.wrong }}
          <template v-if="row.total"> · 本轮共 {{ row.total }} 词</template>
        </div>
      </li>
    </ul>
  </Dialog>
</template>

<style scoped lang="scss">
.stat {
  @apply w-49% box-border flex flex-col items-center justify-center rounded-xl p-2 bg-[var(--bg-history)];
  border: 1px solid gainsboro;

  .num {
    @apply color-[#409eff] text-4xl font-bold;
  }

  .txt {
    @apply color-gray-500;
  }
}

.learning-book-card {
  @apply w-44 rounded-xl p-3 border border-gray-200 bg-[var(--bg-history)] transition-colors;

  &:hover:not(:disabled) {
    @apply border-[#409eff];
  }

  &:focus-visible {
    @apply outline outline-2 outline-offset-2 outline-[#409eff];
  }

  &:disabled {
    @apply opacity-60 cursor-wait;
  }

  &.is-selected {
    @apply border-[#409eff];
    background: rgba(64, 158, 255, 0.1);
  }
}

.learning-book-progress {
  @apply block h-1.5 overflow-hidden rounded-full bg-gray-200;

  > span {
    @apply block h-full rounded-full bg-[#409eff] transition-all;
  }
}

.stat2 {
  @extend .stat;
  @apply py-4 flex-1;
  width: unset;

  .num {
    @apply text-2xl break-keep;
  }
}
</style>
