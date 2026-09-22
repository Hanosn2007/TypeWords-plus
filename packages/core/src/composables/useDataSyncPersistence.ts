import { _getDictDataByUrl, checkAndUpgradeSaveDict, checkAndUpgradeSaveSetting, shakeCommonDict } from '../utils'
import { getPracticeArticleCacheLocal, getPracticeWordCacheBundleLocal, upgradePracticeScopes, notifyPracticeWordCache } from '../utils/cache'
import { SAVE_DICT_KEY, SAVE_SETTING_KEY, LOCAL_FILE_KEY, WEBSITE_VERSION_HASH } from '../config/env'
import { type BaseState, getDefaultBaseState, getDefaultSettingState, useBaseStore, useSettingStore } from '../stores'
import { DictType, SyncDataType } from '../types'
import type { BackupData, SaveData } from '../types'
import { get, getMany, set } from 'idb-keyval'
import { atomicSetMany as setMany } from '../utils/atomicStorage'
import { CloudSync } from '../utils/cloudSync'
import { configureSafeSync, scheduleSafeSync, syncSafely, serializeSyncLocalWrite, replaceLocalSnapshot, flushActiveEditors, LOCAL_REPLACEMENT_KEY } from '../utils/safeSync'
import { rowsSignature, normalizeSyncRows, type SafeRow } from '../utils/syncPolicy'
import { validateRows, validateAttachments, requiredAttachmentIDs, DATA_KEYS, DATA_VERSIONS, decodeArchive, type Attachment } from '../utils/dataArchive'
import { configureLocalHistory, markHistoryDirty, checkpointLocalHistory, checkpointBeforeNewDate, primeLocalHistory, HISTORY_DIRTY_KEY } from '../utils/localHistory'
import { toRaw } from 'vue'

type Options = { pullWhenRemoteNewer?: boolean; pushWhenLocalNewer?: boolean; canSyncRemote?: boolean }
export async function ensureHashGuardBeforeInit() {
  // @ts-ignore Nuxt runtime; no data copies merely because the build changed.
  const config = useRuntimeConfig()
  if (config?.public?.latestCommitHash) await set(WEBSITE_VERSION_HASH, config.public.latestCommitHash)
}

export function useDataSyncPersistence() {
  const store = useBaseStore(), settings = useSettingStore()
  async function readSafeSnapshot(): Promise<SafeRow[]> {
    const [word, article] = await Promise.all([getPracticeWordCacheBundleLocal(), getPracticeArticleCacheLocal()])
    const dict = shakeCommonDict(store.$state), setting = JSON.parse(JSON.stringify(toRaw(settings.$state)))
    for (const data of [dict, setting]) { delete data.load; delete data._ignoreWatch; delete data.__updateLocalData }
    return [
      { type: 'dict', data: dict, data_version: 4 }, { type: 'setting', data: setting, data_version: 25 },
      { type: 'practice_word', data: word, data_version: 3 }, { type: 'practice_article', data: article, data_version: 1 },
    ]
  }
  async function readArchive() {
    const rows = await readSafeSnapshot()
    const needed = new Set(requiredAttachmentIDs(rows))
    const files: Attachment[] = (await get<Attachment[]>(LOCAL_FILE_KEY) || []).filter(f => needed.has(f.id))
    validateAttachments(rows, files)
    return { rows, files }
  }
  configureLocalHistory(async () => {
    const types = Object.keys(DATA_KEYS)
    const values = await getMany([...types.map(t => DATA_KEYS[t]), LOCAL_FILE_KEY])
    const fallback = await readSafeSnapshot()
    const rows = types.map((type, i) => {
      if (!values[i]) return fallback.find(r => r.type === type)!
      const saved = typeof values[i] === 'string' ? JSON.parse(values[i]) : values[i]
      return { type, data: saved.val, data_version: saved.version }
    })
    const ids = new Set(requiredAttachmentIDs(rows))
    const files: Attachment[] = (values[4] || []).filter((f: Attachment) => ids.has(f.id))
    validateRows(rows); validateAttachments(rows, files)
    return { rows, files }
  })

  async function prepareReplacement(rows: SafeRow[], files: Attachment[] = []) {
    validateRows(rows)
    const normalized = normalizeSyncRows(rows)
    for (const row of normalized) {
      if (row.type === 'dict') row.data = await checkAndUpgradeSaveDict({ val: row.data, version: row.data_version }, true)
      if (row.type === 'setting') row.data = await checkAndUpgradeSaveSetting({ val: row.data, version: row.data_version }, true)
      if (row.type === 'practice_word') row.data = upgradePracticeScopes(row.data)
      row.data_version = DATA_VERSIONS[row.type]
    }
    const available = new Map((await get<Attachment[]>(LOCAL_FILE_KEY) || []).map(f => [f.id, f]))
    for (const file of files) available.set(file.id, file)
    validateAttachments(normalized, [...available.values()])
    return normalized
  }

  async function apply(rows: SafeRow[], expected: string, options: { files?: Attachment[]; replacement?: boolean; beforeCommit?: () => void } = {}) {
    validateRows(rows)
    const normalized = normalizeSyncRows(rows)
    const dictRow = normalized.find(r => r.type === 'dict')!, settingRow = normalized.find(r => r.type === 'setting')!
    const dict = await checkAndUpgradeSaveDict({ val: dictRow.data, version: dictRow.data_version }, true)
    const setting = await checkAndUpgradeSaveSetting({ val: settingRow.data, version: settingRow.data_version }, true)
    dict.load = true; dict._ignoreWatch = true
    setting.load = true; setting._ignoreWatch = true
    await serializeSyncLocalWrite(async () => {
      await checkpointBeforeNewDate().catch(console.warn)
      if (rowsSignature(await readSafeSnapshot()) !== expected) throw Error('本机进度已变化，请重新比较；未覆盖本机。')
      const existing: Attachment[] = await get(LOCAL_FILE_KEY) || []
      const supplied = options.files ?? []
      const merged = new Map(existing.map(f => [f.id, f]))
      for (const file of supplied) merged.set(file.id, file)
      validateAttachments(normalized, [...merged.values()])
      const now = new Date().toISOString()
      const values: [IDBValidKey, unknown][] = normalized.map(row => {
        const data = row.type === 'dict' ? dict : row.type === 'setting' ? setting : row.type === 'practice_word' ? upgradePracticeScopes(row.data) : row.data
        return [DATA_KEYS[row.type], JSON.stringify({ val: data, version: DATA_VERSIONS[row.type], updated_at: now })]
      })
      // Keep old attachments while current data or legacy histories may reference them.
      if (supplied.length) values.push([LOCAL_FILE_KEY, [...merged.values()]])
      if (options.replacement) values.push([LOCAL_REPLACEMENT_KEY, true])
      values.push([HISTORY_DIRTY_KEY, now])
      options.beforeCommit?.()
      await setMany(values)
      store.setState(dict); settings.setState(setting)
      notifyPracticeWordCache()
      markHistoryDirty()
    }, 'replacement', false)
    const book = store.sdict
    if (book?.id && !book.custom && !book.system && !book.words.length) {
      void _getDictDataByUrl(book).then(result => { if (store.sdict === book) Object.assign(book, result) }).catch(console.warn)
    }
    const article = store.sbook
    if (article?.id && !article.custom && !article.system && !article.articles.length) {
      void _getDictDataByUrl(article, DictType.article).then(result => { if (store.sbook === article) Object.assign(article, result) }).catch(console.warn)
    }
  }

  configureSafeSync({
    read: readSafeSnapshot, apply, flush: async () => {
      await flushActiveEditors()
      if (store.load && settings.load) {
        await saveDictState(store.$state, { canSyncRemote: false })
        await saveLocalOnly(SyncDataType.setting, JSON.parse(JSON.stringify(toRaw(settings.$state))))
      }
    }, checkpoint: () => serializeSyncLocalWrite(checkpointLocalHistory, 'history', false),
    beforeUpload: rows => { if (requiredAttachmentIDs(rows).length) throw Error('本机文章包含未上传的音频。请用完整ZIP在设备间迁移；本机保存和历史仍可使用。') },
    upgrade: rows => { validateRows(rows); return rows.map(row => row.type === 'practice_word' ? { ...row, data: upgradePracticeScopes(row.data), data_version: 3 } : row) },
  })

  async function saveLocalOnly(type: SyncDataType, val: any, updatedAt = new Date().toISOString()) {
    await serializeSyncLocalWrite(async () => {
      await checkpointBeforeNewDate().catch(console.warn)
      const value = type === SyncDataType.practice_word ? upgradePracticeScopes(val) : val
      await setMany([[DATA_KEYS[type], JSON.stringify({ val: value, version: DATA_VERSIONS[type], updated_at: updatedAt })], [HISTORY_DIRTY_KEY, updatedAt]])
      if (type === SyncDataType.practice_word) notifyPracticeWordCache()
      markHistoryDirty()
    }, type)
  }
  async function saveLocalAndSync(type: SyncDataType, val: any, options: Options = {}) {
    await saveLocalOnly(type, val)
    if (options.canSyncRemote !== false) scheduleSafeSync()
  }
  async function saveDictState(data: BaseState = store.$state, options: Options = {}) {
    await saveLocalAndSync(SyncDataType.dict, shakeCommonDict(data), options)
  }
  async function syncData(_data?: Partial<Record<SyncDataType, SaveData | null>>, options: Options = {}) {
    if (CloudSync.check()) await syncSafely(options.pushWhenLocalNewer !== false && !/\/practice-(words|articles)\//.test(location.pathname))
  }
  // Practice loaders never pull individual rows; only whole-snapshot CAS may replace data.
  async function pullIfRemoteNewer(..._args: any[]): Promise<any> { return null }
  async function pushSnapshotToRemote(..._args: any[]) { scheduleSafeSync(); return true }
  async function forcePushLocalDataToRemote(data: BackupData['val']) { await replaceLocalSnapshot(decodeArchive({ version: 5, val: data }), '导入'); return true }
  async function clear() {
    const rows: SafeRow[] = [
      { type: 'dict', data: getDefaultBaseState(), data_version: 4 }, { type: 'setting', data: getDefaultSettingState(), data_version: 25 },
      { type: 'practice_word', data: null, data_version: 3 }, { type: 'practice_article', data: null, data_version: 1 },
    ]
    await replaceLocalSnapshot(rows, '重置')
    return true
  }
  async function getLocalCompactDataByType(type: SyncDataType) {
    if (type === SyncDataType.practice_word) return getPracticeWordCacheBundleLocal()
    if (type === SyncDataType.practice_article) return getPracticeArticleCacheLocal()
    return (await readSafeSnapshot()).find(row => row.type === type)?.data
  }
  return { readArchive, readSafeSnapshot, prepareReplacement, primeLocalHistory, saveLocalOnly, saveLocalAndSync, saveDictState, syncData, pullIfRemoteNewer, pushSnapshotToRemote, forcePushLocalDataToRemote, getLocalCompactDataByType, clear }
}
