import { SAFE_TYPES, normalizeSyncRows, type SafeRow } from './syncPolicy.ts'

export const DATA_VERSIONS: Record<string, number> = { dict: 4, setting: 25, practice_word: 3, practice_article: 1 }
export const DATA_KEYS: Record<string, string> = { dict: 'typing-word-dict', setting: 'typing-word-setting', practice_word: 'PracticeSaveWord', practice_article: 'PracticeSaveArticle' }
export type Attachment = { id: string; file: Blob }
export type Archive = { format: 'typewords-archive'; version: 1; rows: SafeRow[] }
const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v)
const unpack = (v: any) => typeof v === 'string' ? JSON.parse(v) : v
function validateTask(data: any) {
  if (data === null) return
  if (!object(data)) throw Error('未完成任务损坏。')
  const task = data.taskWordsStr ?? data.taskWords
  if (!object(task) || !Array.isArray(task.new) || !Array.isArray(task.review)) throw Error('任务词表损坏。')
  if (data.taskWordsStr && [...task.new, ...task.review].some(w => typeof w !== 'string')) throw Error('压缩任务词表损坏。')
  if (data.practiceData) {
    const p = data.practiceData, words = p.wordsStr ?? p.words
    if (!Array.isArray(words) || !Number.isInteger(p.index) || p.index < 0 || p.index > words.length) throw Error('任务位置损坏。')
  }
}

/** Strict boundary for imports and remote replacements, not the tolerant startup reader. */
export function validateRows(rows: unknown): asserts rows is SafeRow[] {
  if (!Array.isArray(rows) || rows.length !== 4) throw Error('需要完整的词书、设置、单词任务和文章任务，未修改本机数据。')
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || !SAFE_TYPES.includes(row.type) || seen.has(row.type)) throw Error('数据类型缺失或重复。')
    seen.add(row.type)
    if (!Number.isInteger(row.data_version) || row.data_version < 1 || row.data_version > DATA_VERSIONS[row.type]) throw Error('不支持的数据版本，请使用相应新版网页。')
    const data = row.data
    if (row.type === 'dict') {
      if (!object(data) || !Array.isArray(data.word?.bookList) || !Array.isArray(data.article?.bookList)) throw Error('词书数据无效。')
      for (const group of [data.word, data.article]) {
        if (!Number.isInteger(group.studyIndex) || group.studyIndex < -1 || group.studyIndex >= group.bookList.length) throw Error('当前词书索引无效。')
        const ids = new Set<string>()
        for (const book of group.bookList) {
          if (!object(book) || !book.id || ids.has(String(book.id)) || !Array.isArray(book.words) || !Array.isArray(book.articles) || !Array.isArray(book.statistics)) throw Error('词书身份或内容无效。')
          ids.add(String(book.id))
          if (book.learning && (!object(book.learning.fsrs) || !['learnedWords', 'masteredWords', 'skippedWords'].every(k => Array.isArray(book.learning[k])))) throw Error('词书学习状态无效。')
          if (book.units && (!Array.isArray(book.units) || book.units.some((u: any) => !u.id || typeof u.name !== 'string' || !u.name.trim() || !Array.isArray(u.words)) || new Set(book.units.map((u: any) => u.id)).size !== book.units.length)) throw Error('单元数据无效。')
          if (book.learning && Object.values(book.learning.fsrs).some(card => !object(card))) throw Error('记忆卡片数据无效。')
        }
      }
    } else if (row.type === 'setting') {
      if (!object(data) || !Object.keys(data).length) throw Error('设置数据为空或无效。')
    } else {
      if (data !== null && !object(data)) throw Error('练习任务格式无效。')
      if (row.type === 'practice_word' && data && Object.keys(data).length) {
        if (row.data_version >= 3 && data.schemaVersion !== 3) throw Error('单词任务内部格式与版本不符。')
        if (data.schemaVersion && (![2, 3].includes(data.schemaVersion) || !object(data.entries))) throw Error('单词任务版本或任务集合无效。')
        if (data.schemaVersion) for (const [key, entry] of Object.entries(data.entries) as [string, any][]) {
          if (!object(entry) || !('data' in entry)) throw Error('未完成任务损坏。')
          validateTask(entry.data)
          if (data.schemaVersion === 3) {
            let scope: any
            try { scope = JSON.parse(key) } catch { throw Error('单元任务标识无效。') }
            if (!Array.isArray(scope) || scope.length !== 3 || typeof scope[0] !== 'string' || !scope[0] || typeof scope[1] !== 'string' || !['study', 'free'].includes(scope[2])) throw Error('单元任务标识无效。')
            if (entry.data) {
              const task = entry.data.taskWordsStr ?? entry.data.taskWords
              if ((entry.data.dictId && entry.data.dictId !== scope[0]) || (task.unitId ?? '') !== scope[1] || (entry.data.practiceMode === 1 ? 'free' : 'study') !== scope[2]) throw Error('任务标识与词书、单元或学习模式不一致。')
            }
          }
        }
        else validateTask(data)
        if (data.unresolvedLegacy) validateTask(data.unresolvedLegacy.data)
      }
    }
  }
}

export function decodeArchive(value: unknown, side: 'local' | 'remote' = 'local'): SafeRow[] {
  const input = unpack(value)
  if (!object(input)) throw Error('无法识别数据文件。')
  let rows: SafeRow[]
  if (input.format) {
    if (input.format !== 'typewords-archive' || input.version !== 1) throw Error('无法识别归档版本。')
    rows = input.rows
  } else if (Array.isArray(input.local)) rows = side === 'remote' ? input.remote?.rows : input.local
  else if (Array.isArray(input.rows)) rows = input.rows
  else {
    if (input.version && (!Number.isInteger(input.version) || input.version < 1 || input.version > 5)) throw Error('不支持的旧导出版本。')
    const raw = Array.isArray(input.entries) ? Object.fromEntries(input.entries) : input.val ?? input.data ?? input.indexedDB
    if (!object(raw)) throw Error('不是可恢复的完整学习数据。')
    rows = SAFE_TYPES.map(type => {
      const key = type === 'dict' || type === 'setting' ? type : DATA_KEYS[type]
      const envelope = unpack(raw[key] ?? raw[DATA_KEYS[type]])
      if (!envelope && (type === 'practice_word' || type === 'practice_article')) return { type, data: null, data_version: 1 }
      if (!object(envelope) || !('val' in envelope)) throw Error('数据缺少版本封装：' + type)
      return { type, data: envelope.val, data_version: envelope.version }
    })
  }
  validateRows(rows)
  return normalizeSyncRows(rows)
}

export function encodeArchive(rows: SafeRow[]): Archive { validateRows(rows); return { format: 'typewords-archive', version: 1, rows: normalizeSyncRows(rows) } }

export function requiredAttachmentIDs(rows: SafeRow[]): string[] {
  const books = rows.find(r => r.type === 'dict')?.data?.article?.bookList ?? []
  return [...new Set<string>(books.flatMap((b: any) => (b.articles ?? []).filter((a: any) => a.audioFileId && !a.audioSrc).map((a: any) => String(a.audioFileId))))]
}
export function validateAttachments(rows: SafeRow[], files: Attachment[]) {
  const ids = new Set(files.map(f => f.id))
  if (ids.size !== files.length || files.some(f => !f.id || !(f.file instanceof Blob))) throw Error('音频附件无效或重复。')
  const missing = requiredAttachmentIDs(rows).filter(id => !ids.has(id))
  if (missing.length) throw Error(`缺少 ${missing.length} 个音频附件，请选择包含音频的完整 ZIP；未修改本机数据。`)
}
