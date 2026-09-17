import type { InjectionKey } from 'vue'
import type { PracticeWordCacheStored } from '../utils/cache'

/** The page owns its live task and pauses its writers while replacing that task. */
export interface BookPracticeSettingsContext {
  dictId: () => string
  snapshot: () => Promise<{
    cache: PracticeWordCacheStored | null
    hasUnsavedAnswer?: boolean
    completed?: boolean
  }>
  apply: (saveSettings: () => Promise<void>, rebuild: boolean) => Promise<void>
}

export const bookPracticeSettingsKey: InjectionKey<BookPracticeSettingsContext> = Symbol('bookPracticeSettings')
