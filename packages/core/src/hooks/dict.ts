import type { Article, Dict, TaskWords, Word } from '../types'
import { DictType, getDefaultDict, getDefaultWord } from '../types'
import { useBaseStore } from '../stores/base.ts'
import { useSettingStore } from '../stores/setting.ts'
import { _getDictDataByUrl, cloneDeep, getRandomN, isDictIdMatch, resourceWrap, shuffle, splitIntoN } from '../utils'
import { onMounted, watch } from 'vue'
import { AppEnv, DICT_LIST, DictId } from '../config/env.ts'
import { addDict, detail } from '../apis'
import { useRuntimeStore } from '../stores/runtime.ts'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { computed } from 'vue'
import {
  getBookLearning,
  getBookTaskSettings,
  getNewWordLimit,
  migrateLegacyFsrsToBookLearning,
  normalizeLearningWord,
  selectUnitTaskWords,
  refreshUnitBookProgress,
} from '../utils/bookLearning'

/**
 * Word actions normally apply to the selected study book. Detail pages may
 * supply their displayed book instead; its persisted book-list entry wins over
 * a transient edit clone with the same id.
 */
export function useWordOptions(learningDict?: () => Dict | undefined) {
  const store = useBaseStore()

  function getLearningDict(): Dict {
    const requested = learningDict?.()
    if (!requested) return store.sdict
    return store.word.bookList.find(book => isDictIdMatch(book, requested.id)) ?? requested
  }

  function isWordCollect(val: Word) {
    return !!store.collectWord.words.find(v => v.word.toLowerCase() === val.word.toLowerCase())
  }

  function toggleWordCollect(val: Word) {
    let rIndex = store.collectWord.words.findIndex(v => v.word.toLowerCase() === val.word.toLowerCase())
    if (rIndex > -1) {
      store.collectWord.words.splice(rIndex, 1)
    } else {
      store.collectWord.words.push(val)
    }
    store.collectWord.length = store.collectWord.words.length
  }

  function isWordSimple(val: Word) {
    return getBookLearning(getLearningDict()).masteredWords.includes(normalizeLearningWord(val.word))
  }

  function toggleWordSimple(val: Word) {
    const learning = getBookLearning(getLearningDict())
    const word = normalizeLearningWord(val.word)
    let rIndex = learning.masteredWords.findIndex(v => v === word)
    if (rIndex > -1) {
      learning.masteredWords.splice(rIndex, 1)
    } else {
      learning.masteredWords.push(word)
    }
  }

  function delWrongWord(val: Word) {
    let rIndex = store.wrong.words.findIndex(v => v.word.toLowerCase() === val.word.toLowerCase())
    if (rIndex > -1) {
      store.wrong.words.splice(rIndex, 1)
    }
    store.wrong.length = store.wrong.words.length
  }

  function delSimpleWord(val: Word) {
    const learning = getBookLearning(getLearningDict())
    const word = normalizeLearningWord(val.word)
    let rIndex = learning.masteredWords.findIndex(v => v === word)
    if (rIndex > -1) {
      learning.masteredWords.splice(rIndex, 1)
    }
  }

  function getCollectibleDicts(excludeDictId?: string) {
    return store.word.bookList.filter(dict => {
      if (dict.id !== DictId.wordCollect && !dict.custom) return false
      if (excludeDictId && isDictIdMatch(dict, excludeDictId)) return false
      return true
    })
  }

  function resolveDictInBookList(dict: Dict) {
    return store.word.bookList.find(d => isDictIdMatch(d, dict.id)) ?? dict
  }

  function addWordToDict(val: Word, dict: Dict): { ok: boolean } {
    const target = resolveDictInBookList(dict)
    const rIndex = target.words.findIndex(v => v.word.toLowerCase() === val.word.toLowerCase())
    if (rIndex > -1) return { ok: false }
    target.words.push(val)
    target.length = target.words.length
    return { ok: true }
  }

  async function createCustomDict(name: string): Promise<{ ok: true; dict: Dict } | { ok: false; reason: 'empty' | 'duplicate' | 'api' }> {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, reason: 'empty' }
    if (store.word.bookList.find(v => v.name === trimmed)) {
      return { ok: false, reason: 'duplicate' }
    }
    let data: Dict = getDefaultDict({
      name: trimmed,
      id: 'custom-dict-' + Date.now(),
      custom: true,
    })
    data.type = DictType.word
    if (AppEnv.CAN_REQUEST) {
      const res = await addDict(null, data)
      if (!res.success) return { ok: false, reason: 'api' }
      data = getDefaultDict(res.data)
    }
    store.word.bookList.push(cloneDeep(data))
    return { ok: true, dict: data }
  }

  return {
    isWordCollect,
    toggleWordCollect,
    getCollectibleDicts,
    addWordToDict,
    createCustomDict,
    isWordSimple,
    toggleWordSimple,
    delWrongWord,
    delSimpleWord,
  }
}

export function useArticleOptions() {
  const store = useBaseStore()

  function isArticleCollect(val: Article) {
    return !!store.collectArticle?.articles?.find(v => v.id === val.id)
  }

  //todo 这里先收藏，再修改。收藏里面的未同步。单词也是一样的
  function toggleArticleCollect(val: Article) {
    let rIndex = store.collectArticle.articles.findIndex(v => v.id === val.id)
    if (rIndex > -1) {
      store.collectArticle.articles.splice(rIndex, 1)
    } else {
      store.collectArticle.articles.push(val)
    }
    store.collectArticle.length = store.collectArticle.articles.length
  }

  return {
    isArticleCollect,
    toggleArticleCollect,
  }
}

export function getCurrentStudyWord(): TaskWords {
  const store = useBaseStore()
  let dict = store.sdict
  const start = Math.min(Math.max(Number(dict.lastLearnIndex) || 0, 0), dict.words.length)
  let data: TaskWords = { new: [], review: [], startIndex: start, endIndex: start }
  if (dict.library) data.libraryVersion = dict.library.version
  let isTest = false
  let words = dict.words.slice()
  if (isTest) {
    words = Array.from({ length: 10 }).map((v, i) => {
      return getDefaultWord({ word: String(i) })
    })
  }

  if (words?.length) {
    const learning = getBookLearning(dict)
    // A dict's source words are only present after it has been selected. This
    // is the first point where legacy card ownership can be established safely.
    migrateLegacyFsrsToBookLearning(dict, store.fsrsData)
    const settingStore = useSettingStore()
    data.settings = getBookTaskSettings(dict, settingStore.wordReviewRatio)
    //忽略列表：简单词或已掌握
    const ignoreSet = new Set([
      ...[store.allIgnoreWordsSet, store.knownWordsSet][settingStore.ignoreSimpleWord ? 0 : 1],
      ...learning.skippedWords.map(normalizeLearningWord),
    ])
    const perDay = dict.perDayStudyNumber
    if (dict.units?.length) refreshUnitBookProgress(dict, ignoreSet)
    const taskStart = isTest ? 1 : start
    data.startIndex = taskStart
    const complete = isTest ? true : dict.complete || taskStart >= words.length
    const isEnd = taskStart >= words.length
    const reviewRatio = learning.reviewRatio ?? settingStore.wordReviewRatio

    let end = taskStart
    if (dict.units?.length) {
      const unitTask = selectUnitTaskWords(dict, getNewWordLimit(dict), ignoreSet)
      data.new = unitTask.new
      data.unitId = learning.selectedUnitId ?? ''
      data.unitScannedWords = unitTask.scanned
    } else if (!isEnd) {
      //从start往后取perDay个单词，作为新词
      for (let i = taskStart; i < words.length; i++) {
        let item = words[i]
        if (data.new.length >= perDay) break
        if (!ignoreSet.has(normalizeLearningWord(item.word))) {
          data.new.push(item)
        }
        end++
      }
    }
    data.endIndex = end

    //如果复习比大于等于1，或者已完成，才生成复习词
    if (reviewRatio >= 1 || complete || isEnd) {
      //Map建立索引，用于查找、包含
      const wordMap = new Map(words.map(s => [normalizeLearningWord(s.word), s]))
      //复习总数量;如果已结束那么复习比最小是1
      const totalNeed = perDay * (isEnd ? reviewRatio || 1 : reviewRatio)
      const now = Date.now()

      let waitRemoveFromFsrsData = []

      //取 due 到期的单词
      let reviewWordStrList = Object.entries(store.currentFsrsData)
        .filter(([word, card]) => {
          //1、这里的due字段被json序列化之后又恢复是字符串了，所以要用dayjs比较
          //2、要在当前学习这本词典里面
          //3、不在新词里面
          // console.log(`单词：${word},到期时间：${dayjs(card.due).format('YYYY-MM-DD HH:mm:ss')}`)
          const wordKey = normalizeLearningWord(word)
          let isMastered = ignoreSet.has(wordKey)
          if (isMastered) {
            waitRemoveFromFsrsData.push(wordKey)
          }
          return (
            !isMastered &&
            dayjs(card.due).valueOf() <= now &&
            wordMap.has(wordKey) &&
            !data.new.find(v => normalizeLearningWord(v.word) === wordKey)
          )
        })
        .sort((a, b) => dayjs(a[1].due).valueOf() - dayjs(b[1].due).valueOf())
        .map(([word]) => word)

      waitRemoveFromFsrsData.map(word => {
        delete store.currentFsrsData[word]
      })
      // console.log('fsrs 里 due 到期单词', reviewWordStrList)

      data.review = shuffle(
        reviewWordStrList
          .slice(0, totalNeed)
          .map(word => wordMap.get(normalizeLearningWord(word)))
          .filter(obj => obj)
      )
      //如果数量不够再填充
      if (data.review.length < totalNeed) {
        // 固定填充逻辑
        const learnedSet = new Set(learning.learnedWords)
        let list = dict.units?.length
          ? words.filter(item => learnedSet.has(normalizeLearningWord(item.word))).reverse()
          : words.slice(0, taskStart).reverse()
        if (complete && !dict.units?.length) list = list.concat(words.slice(end).reverse())
        // 固定填充复习词需要过滤掉有FSRS记录的
        let set = new Set(
          Array.from(ignoreSet)
            .concat(Object.keys(store.currentFsrsData))
            .concat(data.new.map(v => normalizeLearningWord(v.word)))
        )
        list = list.filter(item => !set.has(normalizeLearningWord(item.word)))
        data.review = data.review.concat(list.slice(0, totalNeed - data.review.length))
      }
    }
  }
  return data
}

export function useGetDict() {
  const store = useBaseStore()
  const runtimeStore = useRuntimeStore()
  let waiting = $ref(false)
  let fetching = $ref(false)
  const route = useRoute()
  const router = useRouter()

  watch(
    [() => store.load, () => waiting],
    ([a, b]) => {
      if (a && b) {
        loadDict()
      }
    },
    { immediate: true }
  )

  onMounted(() => {
    // console.log('onMounted')
    if (route.query?.isAdd) {
      runtimeStore.editDict = getDefaultDict()
    } else {
      if (!runtimeStore.editDict?.id) {
        let dictId = route.params?.id
        if (!dictId) {
          return router.push('/articles')
        }
        waiting = true
      } else {
        loadDict(runtimeStore.editDict)
      }
    }
  })

  async function loadDict(dict?: Dict) {
    if (!dict) {
      dict = getDefaultDict()
      let dictId = route.params.id
      //先在自己的词典列表里面找，如果没有再在资源列表里面找
      dict = store.article.bookList.find(v => isDictIdMatch(v, dictId))
      let r = await fetch(resourceWrap(DICT_LIST.ARTICLE.ALL))
      let dict_list = await r.json()
      if (!dict) dict = dict_list.flat().find(v => isDictIdMatch(v, dictId)) as Dict
    }
    if (dict && dict.id) {
      if (
        !dict?.articles?.length &&
        !dict?.custom &&
        !dict?.system &&
        !dict?.is_default
      ) {
        fetching = true
        let r = await _getDictDataByUrl(dict, DictType.article)
        runtimeStore.editDict = r
      }
      if (store.article.bookList.find(book => book.id === runtimeStore.editDict.id)) {
        if (AppEnv.CAN_REQUEST) {
          let res = await detail({ id: runtimeStore.editDict.id })
          if (res.success) {
            runtimeStore.editDict.statistics = res.data.statistics
            if (res.data.articles.length) {
              runtimeStore.editDict.articles = res.data.articles
            }
          }
        }
      }
    } else {
      router.push('/articles')
    }

    waiting = false
    fetching = false
  }

  const loading = computed(() => waiting || fetching)

  return { loading }
}
