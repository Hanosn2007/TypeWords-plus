import { APP_VERSION, AppEnv } from '../config/env'
import { debounce } from '../utils'
import { syncSetting } from '../apis'
import { useBaseStore, useRuntimeStore, useSettingStore, useUserStore } from '../stores'
import type { BaseState, SettingState } from '../stores'
import { Supabase } from '../utils/supabase'
import { CloudSync } from '../utils/cloudSync'
import { claimSyncWriter } from '../utils/safeSync'
import { ensureHashGuardBeforeInit, useDataSyncPersistence } from './useDataSyncPersistence'
import { usePracticeWordPersistence } from './usePracticePersistence'
import { SyncDataType } from '../types'
import type { SubscriptionCallbackMutation } from 'pinia'
import { onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
// import { startRrwebRecording } from './useRrweb'

let unsub = null
let unsub2 = null

export function useInit() {
  const store = useBaseStore()
  const settingStore = useSettingStore()
  const runtimeStore = useRuntimeStore()
  const route = useRoute()
  // const userStore = useUserStore()
  const dataSync = useDataSyncPersistence()
  let initializing = false // 标记是否正在初始化
  let focus = true
  let fetching = false
  let fetching2 = false
  let restoreFetching = false

  async function flushLocalBeforeLeaving() {
    if (!store.load || !settingStore.load || runtimeStore.globalLoading) return
    try {
      await dataSync.saveDictState(store.$state, { canSyncRemote: false })
      await dataSync.saveLocalAndSync(SyncDataType.setting, settingStore.$state, { canSyncRemote: false })
    } catch (error) { console.error('离开页面前本机保存失败', error) }
  }

  const onvisibilitychange = async () => {
    focus = !document.hidden
    if (!focus) { await flushLocalBeforeLeaving(); return }
    if (focus) {
      // A word-practice page owns in-memory task and learning state. Its
      // practice persistence flushes on visibility changes; do not replace
      // the base store with a background remote pull in that narrow window.
      // Explicit sync actions use other paths and remain available.
      if (route.path.startsWith('/practice-words/')) return
      try {
        //当激活时，要先获取数据，以保证本地是最新的，以免本地老数据上传到后端覆盖新数据
        if (restoreFetching) return
        restoreFetching = true
        await dataSync.syncData(
          { [SyncDataType.dict]: null, [SyncDataType.setting]: null },
          //只拉不推送
          { pushWhenLocalNewer: false }
        )
      } finally {
        restoreFetching = false
      }
    }
  }

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onvisibilitychange)
    window.removeEventListener('pagehide', flushLocalBeforeLeaving)
  })

  //init 有可能重复执行，因为从老网站导了数据之后需要 init
  async function init() {
    if (initializing) return
    initializing = true
    if (import.meta.client && !(await claimSyncWriter())) {
      window.dispatchEvent(new Event('typewords-sync-readonly'))
      initializing = false
      return
    }
    console.time('init')

    //先清理副作用，避免重复监听
    unsub?.()
    unsub2?.()
    document.removeEventListener('visibilitychange', onvisibilitychange)
    window.removeEventListener('pagehide', flushLocalBeforeLeaving)

    await ensureHashGuardBeforeInit()
    // await userStore.init()
    let dictData = await store.init()
    // Attribute an old unscoped practice cache only once, before navigation can
    // change the selected book. `store.init()` has restored that persisted book.
    if (dictData && store.sdict?.id) {
      await usePracticeWordPersistence().migrateUnscopedLocalLegacyCache(String(store.sdict.id))
    }
    let settingData = await settingStore.init()
    if (dictData && settingData) {
      await dataSync.syncData({
        [SyncDataType.dict]: dictData,
        [SyncDataType.setting]: settingData,
      })
    }
    settingStore.load = true
    store.load = true
    console.timeEnd('init')
    initializing = false // 初始化完成，允许保存数据

    //等数据全部准备好，再开启监听，避免循环保存-同步
    document.addEventListener('visibilitychange', onvisibilitychange)
    window.addEventListener('pagehide', flushLocalBeforeLeaving)
    //用 $subscribe 替代 watch
    unsub = store.$subscribe(
      debounce(async (mutation, data: BaseState) => {
        if (runtimeStore.globalLoading || restoreFetching) return
        if (data._ignoreWatch) {
          data._ignoreWatch = false
          return
        }
        if (mutation.type === 'direct' && mutation.events?.key === '_ignoreWatch') {
          return
        }
        console.log('store.$subscribe', mutation, data, data._ignoreWatch)
        fetching = true
        try {
          await dataSync.saveDictState(data)
        } finally {
          fetching = false
        }
      }, 1000)
    )

    unsub2 = settingStore.$subscribe(
      debounce(async (mutation: SubscriptionCallbackMutation<SettingState>, data: SettingState) => {
        if (runtimeStore.globalLoading || restoreFetching) return
        console.log('settingStore.$subscribe', mutation, data, data._ignoreWatch)
        if (data._ignoreWatch) {
          data._ignoreWatch = false
          return
        }
        if (mutation.type === 'direct' && mutation.events?.key === '_ignoreWatch') {
          return
        }
        fetching2 = true
        try {
          await dataSync.saveLocalAndSync(SyncDataType.setting, data, { pullWhenRemoteNewer: false })
        } finally {
          fetching2 = false
        }
        if (AppEnv.CAN_REQUEST) {
          syncSetting(null, settingStore.$state)
        }
      }, 1000)
    )

    runtimeStore.isNew = APP_VERSION.version > Number(settingStore.webAppVersion)
    // runtimeStore.isNew = true
    runtimeStore.isError = (CloudSync.check() ? CloudSync.getStatus() : Supabase.getStatus()).status === 'error'
    window.umami?.track('host', { host: window.location.host })

    // 静默后台录制用户操作，数据保存到 IndexedDB
    // startRrwebRecording().catch(console.error)
  }

  return init
}
