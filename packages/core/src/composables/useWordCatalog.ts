import { onMounted, ref } from 'vue'
import type { DictResource } from '../types/types'
import { DICT_LIST } from '../config/env'
import { resourceWrap } from '../utils'
import { loadWordCatalog } from '../utils/libraryBooks'

export function useWordCatalog(recommended = false) {
  const data = ref<DictResource[]>([])
  const isFetching = ref(true)
  const error = ref('')
  async function refresh() {
    isFetching.value = true
    try {
      data.value = await loadWordCatalog(resourceWrap(recommended ? DICT_LIST.WORD.RECOMMENDED : DICT_LIST.WORD.ALL), recommended)
      error.value = ''
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '词书目录加载失败'
    } finally { isFetching.value = false }
  }
  onMounted(refresh)
  return { data, isFetching, error, refresh }
}
