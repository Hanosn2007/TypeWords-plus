import { DictType, Frequency, PracticeArticleWordType, WordPracticeMode } from './enum'
import type { Card, Rating } from 'ts-fsrs'
import { PRACTICE_ARTICLE_CACHE, PRACTICE_WORD_CACHE } from '../utils/cache'
import { APP_VERSION } from '../config/env'

export type Word = {
  id?: string
  custom?: boolean
  word: string
  phonetic0: string
  phonetic1: string
  trans: {
    pos: string
    cn: string
    frequency?: Frequency
  }[]
  sentences: {
    c: string //content
    cn: string
  }[]
  phrases: {
    c: string
    cn: string
  }[]
  synos: {
    pos: string
    cn: string
    ws: string[]
  }[]
  relWords: {
    root: string
    rels: {
      pos: string
      words: {
        c: string
        cn: string
      }[]
    }[]
  }
  etymology: {
    t: string //title
    d: string //desc
  }[]
}

export type TranslateLanguageType = 'en' | 'zh-CN' | 'ja' | 'de' | 'common' | ''
export type LanguageType = 'en' | 'ja' | 'de' | 'code'

export interface ArticleWord extends Word {
  nextSpace: boolean
  symbolPosition: 'start' | 'end' | ''
  input: string
  type: PracticeArticleWordType
}

export interface Sentence {
  text: string
  translate: string
  words: ArticleWord[]
  audioPosition: number[]
}

export interface Article {
  id?: number | string
  title: string
  titleTranslate: string
  text: string
  textTranslate: string
  newWords: Word[]
  sections: Sentence[][]
  audioSrc: string
  audioFileId: string
  lrcPosition?: number[][]
  nameList?: string[]
  questions?: {
    stem: string
    options: string[]
    correctAnswer: string[]
    explanation: string
  }[]
  quote?: {
    start: number
    text: string
    translate: string
    end: number
  }
  question?: {
    start: number
    text: string
    translate: string
    end: number
  }
}

export interface Statistics {
  startDate: number //开始日期
  spend: number //花费时间
  total: number //单词数量
  new: number //新学单词数量
  review: number //复习单词数量
  wrong: number //错误数
  /** 本次主动跳过的词数（老记录缺失时按 0 处理） */
  skipped?: number
  title?: string //文章标题
  /** 本日实际学习的时间片段列表，每项为 [startMs, endMs] */
  segments?: [number, number][]
  /**
   * 本条记录在整次练习中的角色（仅跨天练习时有意义）：
   * - 'single'：整次练习仅一天（含老数据默认情况）
   * - 'start'  ：多天练习的第一天
   * - 'middle' ：多天练习的中间日
   * - 'end'    ：多天练习的最后一天
   */
  sessionRole?: 'single' | 'start' | 'middle' | 'end'
}

export type DictResource = {
  id: string | number
  /** Immutable shared-library release; independent of a private copy's sourceId. */
  library?: { bookId: string; version: number }
  enName?: string
  name: string
  description: string
  url: string
  length: number
  category: string
  tags: string[]
  translateLanguage: TranslateLanguageType
  //todo 可以考虑删除了
  type?: DictType
  version?: number
  language: LanguageType
}

/** 单元成员按词条保存，避免缺词、补词或调序改变所属单元。 */
export interface BookUnit {
  id: string
  name: string
  words: string[]
}

export interface Dict extends DictResource {
  lastLearnIndex: number
  perDayStudyNumber: number
  words: Word[]
  articles: Article[]
  statistics: Statistics[]
  custom: boolean //是否是自定义词典
  system?: boolean //是否是系统虚拟词典（收藏/错词/已掌握/文章收藏），可编辑词条但不能改名，不显示tag
  sourceId?: string //如果是官方资源副本，这里记录原始官方资源 id
  complete: boolean //是否学习完成，学完了设为true，然后lastLearnIndex重置
  /** 词书独立的学习状态；没有该字段的旧存档仍可读取。 */
  learning?: BookLearning
  /** 可选单元结构；没有单元的词书沿用原来的顺序学习。 */
  units?: BookUnit[]
  //后端字段
  enName?: string
  createdBy?: string
  category_id?: number
  is_default?: boolean
  update?: boolean
  cover?: string
  sync?: boolean
  userDictId?: number
}

export interface ArticleItem {
  item: Article
  index: number
}

export interface PracticeData {
  index: number
  words: Word[]
  wrongWords: Word[]
  excludeWords: string[]
  allWrongWords: string[]
  isTypingWrongWord: boolean
  // word -> wrongTimes 用以评级
  wrongTimesMap: Record<string, number>
  /** 本次练习中主动跳过的词。跳过不等同于已学习。 */
  duplicateSkippedWords?: string[]
  wrongTimes: number
  ratingMap: Record<string, Rating>
  question: Question
}

export interface TaskWords {
  new: Word[]
  review: Word[]
  /** Shared release used when this round was generated, including route-only tasks. */
  libraryVersion?: number
  /** 生成本轮时使用的数量设置，用于判断是否需要立即重建。 */
  settings?: BookTaskSettings
  /** 本批新词开始前的词书游标。 */
  startIndex?: number
  /** 本批处理过的最后一个词后的游标，包含被忽略/跳过的词。 */
  endIndex?: number
  /** 生成任务时的单元；空字符串表示带单元词书的整书学习。 */
  unitId?: string
  /** 单元任务实际扫描的成员，包含被忽略的词；仅在本轮结算时计为已处理。 */
  unitScannedWords?: string[]
  /** 重练已经完成的单元，保留新词进度。 */
  unitReview?: boolean
}

export type DuplicateMode = 'off' | 'manual' | 'auto'
export type NewWordMode = 'unit' | 'custom'

export interface BookTaskSettings {
  newWordMode: NewWordMode
  perDayStudyNumber: number
  reviewRatio: number
}

/** 词书级别的学习状态，词均以 normalizeLearningWord() 的结果作为 key。 */
export interface BookLearning {
  version: 1
  fsrs: Record<string, Card>
  learnedWords: string[]
  masteredWords: string[]
  skippedWords: string[]
  duplicateMode: DuplicateMode
  /** Optional per-book override; absent keeps the global setting. */
  reviewRatio?: number
  /** Optional per-book override for normal word practice modes (0..6). */
  practiceMode?: WordPracticeMode
  /** 空值为整书学习；单元标识随词书学习设置同步。 */
  selectedUnitId?: string
  /** 有所选单元时默认跟随单元；整书学习始终使用自定义数量。 */
  newWordMode?: NewWordMode
  /** Last locally settled round; prevents restoring its cache after an interrupted clear. */
  lastCompletedPracticeAt?: number
  /** 已处理成员包含跳过/忽略词，独立于 learnedWords 的“实际学过”。 */
  unitProcessedWords?: string[]
  /** 仅用于防止旧全局 FSRS 在每次重新载入词书时重复回填。 */
  legacyFsrsMigrated?: boolean
}

export interface SaveData {
  val: any
  version: number
  updated_at?: string
}

export interface Snapshot {
  meta: {
    currentHash: string
    previousHash: string
    createdAt: number
  }
  data: {
    dict: string
    setting: string
    [PRACTICE_WORD_CACHE.key]: string
    [PRACTICE_ARTICLE_CACHE.key]: string
    [APP_VERSION.key]: number
  }
}

export interface BackupData {
  version: number
  val: {
    dict: SaveData
    setting: SaveData
    [PRACTICE_WORD_CACHE.key]: SaveData
    [PRACTICE_ARTICLE_CACHE.key]: SaveData
    [APP_VERSION.key]: number
  }
}

export type Candidate = { word: Word; similarity: number }

export type Question = {
  candidates: Candidate[]
  correctIndex: number
}
// 类型定义
export interface Resource {
  name?: string
  description?: string
  difficulty?: string
  link?: string
  author?: string
  features?: string
  suitable?: string
  type?: string
  children?: Resource[]
}
