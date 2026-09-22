import { shallowRef } from 'vue'
import { get } from 'idb-keyval'
import { atomicSetMany as setMany } from '../utils/atomicStorage'
import { PRACTICE_WORD_CACHE, upgradePracticeScopes } from '../utils/cache'
import { SAVE_DICT_KEY, SAVE_SETTING_KEY } from '../config/env'

export const studyUpgrade = shallowRef({ required: false, busy: false, error: '' })
let resume: (() => void) | undefined
let captured: [IDBValidKey, unknown][] = []
const parse = (raw: any) => typeof raw === 'string' ? JSON.parse(raw) : raw

/** Runs before store subscriptions. Conversion and its recovery copy commit atomically. */
export async function ensureStudyUpgrade(): Promise<void> {
  const raw = await get(PRACTICE_WORD_CACHE.key) ?? localStorage.getItem(PRACTICE_WORD_CACHE.key)
  if (!raw) return
  let error = ''
  try { if (parse(raw)?.val?.schemaVersion === 3) return }
  catch { error = '旧任务数据无法解析，请先导出副本，暂不更新。' }
  captured = await Promise.all([SAVE_DICT_KEY.key, SAVE_SETTING_KEY.key, PRACTICE_WORD_CACHE.key, 'PracticeSaveArticle']
    .map(async key => [key, await get(key) ?? localStorage.getItem(key)] as [IDBValidKey, unknown]))
  studyUpgrade.value = { required: true, busy: false, error }
  await new Promise<void>(resolve => { resume = resolve })
}

export async function acceptStudyUpgrade() {
  if (studyUpgrade.value.busy) return
  studyUpgrade.value = { required: true, busy: true, error: '' }
  try {
    const raw = captured.find(([key]) => key === PRACTICE_WORD_CACHE.key)?.[1]
    const meta = parse(raw)
    let payload = meta?.val
    if (payload && !payload.entries && !payload.dictId) {
      const dict = parse(captured.find(([key]) => key === SAVE_DICT_KEY.key)?.[1])?.val
      const active = dict?.word?.bookList?.[dict?.word?.studyIndex]
      if (active?.id) payload = { ...payload, dictId: String(active.id) }
    }
    const bundle = upgradePracticeScopes(payload, meta?.updated_at)
    // Keep unidentifiable historical tasks unresolved; never guess from today's selection.
    await setMany([
      ['typewords-before-study-scopes-v3', { createdAt: new Date().toISOString(), entries: captured }],
      [PRACTICE_WORD_CACHE.key, JSON.stringify({ ...meta, version: 3, val: bundle })],
    ])
    studyUpgrade.value = { required: false, busy: false, error: '' }
    resume?.(); resume = undefined
  } catch (error) {
    studyUpgrade.value = { required: true, busy: false, error: `更新未完成，原数据未被替换：${(error as Error).message}` }
  }
}

export function exportBeforeStudyUpgrade() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ entries: captured })], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = 'TypeWords-before-unit-update.json'; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
