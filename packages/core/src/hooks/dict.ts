import type { Article, Dict, TaskWords, Word } from '../types'
import { DictType, getDefaultDict } from '../types'
import { useBaseStore } from '../stores/base.ts'
import { useSettingStore } from '../stores/setting.ts'
import { _getDictDataByUrl, cloneDeep, getRandomN, isDictIdMatch, resourceWrap, shuffle, splitIntoN } from '../utils'
import { onMounted, watch } from 'vue'
import { AppEnv, DICT_LIST, DictId } from '../config/env.ts'
import { addDict, detail } from '../apis'
import { useRuntimeStore } from '../stores/runtime.ts'
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'
import {
  getBookLearning,
  normalizeLearningWord,
} from '../utils/bookLearning'
import { planStudyTask } from '../learning/planStudyTask'
import { prepareStudyBook, applyStudyCardCleanup } from '../learning/prepareStudyBook'

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

/** Legacy UI adapter: explicit preparation, pure planning, then existing cleanup. */
export function getCurrentStudyWord(): TaskWords {
  const store = useBaseStore()
  const settings = useSettingStore()
  const book = store.sdict
  const startIndex = Math.min(Math.max(Number(book.lastLearnIndex) || 0, 0), book.words.length)
  const ignoredWords = settings.ignoreSimpleWord ? store.allIgnoreWordsSet : store.knownWordsSet
  prepareStudyBook(book, store.fsrsData, ignoredWords)
  const plan = planStudyTask({
    book, ignoredWords, startIndex,
    defaultReviewRatio: settings.wordReviewRatio,
    now: Date.now(), random: Math.random,
  })
  applyStudyCardCleanup(book, plan.ignoredCardKeys)
  return plan.task
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
