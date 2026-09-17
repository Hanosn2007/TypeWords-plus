import { defineStore } from 'pinia'
import { useSettingStore } from './setting'
import { WordPracticeStage } from '../types'
import { WordPracticeModeStageMap, WordPracticeStageNameMap } from '../config/env'
import {
  initializePracticeTimeAccounting,
  resetPracticeTimeAccounting,
  startPracticeTimeSegment,
  syncPracticeTime,
  type PracticeTimeAccounting,
} from '../utils/practiceTime'

export type TimerPauseReason = null | 'manual' | 'auto_visibility' | 'auto_idle'

// Persistent `timeAccounting` records how an unfinished word round should be
// reconciled. Whether the unified word timer is active is intentionally local
// to this Pinia runtime so article and VS Code caches cannot opt in by merely
// restoring that metadata.
const unifiedTimerStates = new WeakSet<object>()

function getTimerRuntimeKey(store: { $state?: object }): object {
  return store.$state && typeof store.$state === 'object' ? store.$state : store
}

function enableUnifiedTimer(store: { $state?: object }) {
  unifiedTimerStates.add(getTimerRuntimeKey(store))
}

function disableUnifiedTimer(store: { $state?: object }) {
  unifiedTimerStates.delete(getTimerRuntimeKey(store))
}

export function isUnifiedPracticeTimer(store: { $state?: object }): boolean {
  return unifiedTimerStates.has(getTimerRuntimeKey(store))
}

export interface PracticeState {
  stage: WordPracticeStage
  startDate: number
  spend: number
  total: number
  newWordNumber: number
  skippedWordNumber: number
  reviewWordNumber: number
  inputWordNumber: number //当前总输入了多少个单词（不包含跳过）
  wrong: number
  /** 学习计时是否暂停（单词练习页 interval 不累计 spend） */
  timerPaused: boolean
  /** 暂停原因：手动 / 切走标签 / 长时间无键盘操作 */
  timerPauseReason: TimerPauseReason
  /**
   * 学习时间片段列表，每项为 [startMs, endMs]。
   * - resumeTimer 时 push [now, now] 开启新片段
   * - 计时进行中 end 实时被更新（保存/暂停时写入当前时刻）
   * - pauseTimer 时将最后一条 end 更新为暂停时刻，使其定格
  */
  segments: [number, number][]
  /** Keeps an old cache's saved duration separate from newly measured segments. */
  timeAccounting?: PracticeTimeAccounting
}

export const usePracticeStore = defineStore('practice', {
  state: (): PracticeState => {
    return {
      stage: WordPracticeStage.FollowWriteNewWord,
      spend: 0,
      startDate: Date.now(),
      total: 0,
      newWordNumber: 0,
      reviewWordNumber: 0,
      skippedWordNumber: 0,
      inputWordNumber: 0,
      wrong: 0,
      timerPaused: false,
      timerPauseReason: null,
      segments: [],
      timeAccounting: undefined,
    }
  },
  getters: {
    getStageName: state => {
      return WordPracticeStageNameMap[state.stage]
    },
    nextStage: state => {
      const settingStore = useSettingStore()
      const stages = WordPracticeModeStageMap[settingStore.wordPracticeMode]
      const index = stages.findIndex(v => v === state.stage)
      return stages[index + 1]
    },
  },
  actions: {
    initializeTimeAccounting(forceLegacy: boolean = false) {
      enableUnifiedTimer(this)
      return initializePracticeTimeAccounting(this, forceLegacy)
    },
    resetTimeAccounting() {
      enableUnifiedTimer(this)
      return resetPracticeTimeAccounting(this)
    },
    disableTimeAccounting() {
      disableUnifiedTimer(this)
    },
    startTimerSegment(now: number = Date.now()) {
      const segment = startPracticeTimeSegment(this, now)
      this.timerPaused = false
      this.timerPauseReason = null
      return segment
    },
    syncTimer(now: number = Date.now()) {
      if (this.timerPaused) return 0
      // Article and VS Code flows share this store but retain their legacy timer
      // behavior until the Nuxt word practice page explicitly enables accounting.
      if (!isUnifiedPracticeTimer(this)) return 0
      return syncPracticeTime(this, now)
    },
    pauseTimer(reason: TimerPauseReason, now: number = Date.now()) {
      if (this.timerPaused) return
      if (isUnifiedPracticeTimer(this)) {
        this.syncTimer(now)
      } else {
        // A legacy client may have restored a Nuxt cache. Its next save must
        // not carry an obsolete baseline into a fresh later round.
        this.timeAccounting = undefined
        if (this.segments.length > 0) this.segments[this.segments.length - 1][1] = now
      }
      this.timerPaused = true
      this.timerPauseReason = reason
    },
    resumeTimer(now: number = Date.now()) {
      if (isUnifiedPracticeTimer(this)) {
        if (!this.timerPaused) return
        this.startTimerSegment(now)
      } else {
        this.timeAccounting = undefined
        this.timerPaused = false
        this.timerPauseReason = null
        this.segments.push([now, now])
      }
    },
  },
})
