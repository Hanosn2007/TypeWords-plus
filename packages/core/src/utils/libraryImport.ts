import { parseUnitImport } from './unitImport.ts'
import { normalizeLearningWord } from './bookLearning.ts'
import type { LibraryBookContent } from '../types/library.ts'
import type { Word } from '../types/types.ts'

export function emptyLibraryContent(): LibraryBookContent {
  return { name: '未命名词书', description: '', language: 'en', translateLanguage: 'zh-CN', category: '学校词书', tags: [], recommended: false, sortOrder: 0, words: [], units: [] }
}

export interface LibraryImportResult { content: LibraryBookContent; duplicates: number; missingDefinitions: number; warnings: string[] }
const text = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v !== 'string') throw new Error('文本字段必须是字符串。')
  return v.trim()
}
const blocks = (v: unknown) => text(v).split(/\r?\n\s*\r?\n/).filter(Boolean)
const field = (row: Record<string, unknown>, ...names: string[]) => names.map(name => row[name]).find(v => v != null && (typeof v !== 'string' || v.trim()))
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('词条及富字段项目必须是对象。')
  return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('富字段集合必须是数组。')
  return value
}

export function parseLibraryTranslations(v: unknown): Word['trans'] {
  if (Array.isArray(v)) return v.map(item => {
    const row = record(item)
    const result: Word['trans'][number] = { pos: text(row.pos), cn: text(row.cn) }
    if (row.frequency !== undefined) {
      if (![0, 1, 2].includes(row.frequency as number)) throw new Error('词频 frequency 必须是 0、1 或 2。')
      result.frequency = row.frequency as Word['trans'][number]['frequency']
    }
    return result
  })
  return text(v).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^([a-zA-Z]+\.)\s*(.*)$/)
    return { pos: match?.[1] ?? '', cn: match?.[2] ?? line }
  })
}

export function parseLibraryPairs(v: unknown): { c: string; cn: string }[] {
  if (Array.isArray(v)) return v.map(item => { const row = record(item); return { c: text(row.c), cn: text(row.cn) } })
  return blocks(v).map(block => { const [c, ...rest] = block.split(/\r?\n/); return { c: c.trim(), cn: rest.join('\n').trim() } })
}

export function libraryWordFromRow(row: Record<string, unknown>): Partial<Word> {
  record(row)
  const word: Partial<Word> = {
    word: text(field(row, '单词', 'word')),
    phonetic0: text(field(row, '音标①', 'phonetic0')), phonetic1: text(field(row, '音标②', 'phonetic1')),
    trans: parseLibraryTranslations(field(row, '翻译', 'trans')),
    sentences: parseLibraryPairs(field(row, '例句', 'sentences')),
    phrases: parseLibraryPairs(field(row, '短语', 'phrases')),
  }
  if (row.id != null) word.id = typeof row.id === 'number' && Number.isSafeInteger(row.id) ? String(row.id) : text(row.id)
  const synos = field(row, '近义词', 'synos')
  if (Array.isArray(synos)) word.synos = synos.map(item => {
    const row = record(item)
    return { pos: text(row.pos), cn: text(row.cn), ws: array(row.ws).map(text) }
  })
  else if (text(synos)) word.synos = blocks(synos).map(block => {
    const [heading = '', members = ''] = block.split(/\r?\n/)
    const parsed = parseLibraryTranslations(heading)[0]
    return { pos: parsed?.pos ?? '', cn: parsed?.cn ?? '', ws: members.split('/').map(s => s.trim()).filter(Boolean) }
  })
  const related = field(row, '同根词', 'relWords')
  if (related && typeof related === 'object' && !Array.isArray(related)) {
    const row = record(related)
    word.relWords = { root: text(row.root), rels: array(row.rels).map(item => {
      const relation = record(item)
      return { pos: text(relation.pos), words: parseLibraryPairs(array(relation.words)) }
    }) }
  }
  else if (text(related)) {
    const lines = text(related).split(/\r?\n/).filter(Boolean)
    const rels: Word['relWords']['rels'] = []
    for (const line of lines.slice(1)) {
      if (/^[a-zA-Z]+\./.test(line)) rels.push({ pos: line.replace(/:$/, '').trim(), words: [] })
      else if (line.includes(':') && rels.length) {
        const at = line.indexOf(':')
        rels[rels.length - 1].words.push({ c: line.slice(0, at).trim(), cn: line.slice(at + 1).trim() })
      }
    }
    word.relWords = { root: (lines[0] ?? '').replace(/^词根[:：]/, '').trim(), rels }
  }
  const etymology = field(row, '词源', 'etymology')
  if (Array.isArray(etymology)) word.etymology = etymology.map(item => { const row = record(item); return { t: text(row.t), d: text(row.d) } })
  else if (text(etymology)) word.etymology = blocks(etymology).map(block => {
    const [t, ...rest] = block.split(/\r?\n/); return { t, d: rest.join('\n') }
  })
  // Notes and learning fields are personal data, never copied into public content.
  return word
}

function finish(content: LibraryBookContent, warnings: string[] = []): LibraryImportResult {
  const seen = new Map<string, Partial<Word>>()
  let duplicates = 0
  for (const item of content.words) {
    const key = normalizeLearningWord(item.word)
    if (!key) { warnings.push('已忽略没有单词的空白行。'); continue }
    const existing = seen.get(key)
    if (existing) {
      duplicates++
      for (const [name, value] of Object.entries(item)) {
        const old = existing[name]
        const emptyRichField = name === 'trans' && !existing.trans?.some(t => text(t.cn)) ||
          name === 'relWords' && !existing.relWords?.root && !existing.relWords?.rels.length
        if ((old == null || old === '' || (Array.isArray(old) && !old.length) || emptyRichField) && value != null) existing[name] = value
      }
    } else seen.set(key, item)
  }
  content.words = [...seen.values()]
  return { content, duplicates, missingDefinitions: content.words.filter(w => !w.trans?.some(t => text(t.cn))).length, warnings: [...new Set(warnings)] }
}

export function parseLibraryRows(rows: Record<string, unknown>[], name = '导入词书'): LibraryImportResult {
  if (!Array.isArray(rows)) throw new Error('表格行必须是数组。')
  const content = { ...emptyLibraryContent(), name }
  const groups = new Map<string, { id: string; name: string; words: string[] }>()
  const usedIds = new Set(rows.map(row => text(field(record(row), '单元ID', 'unitId'))).filter(Boolean))
  const warnings: string[] = []
  for (const row of rows) {
    const word = libraryWordFromRow(row)
    if (!text(word.word)) { warnings.push('已忽略没有单词的空白行。'); continue }
    content.words.push(word)
    const unitName = text(field(row, '单元', 'Lesson', 'lesson', 'Unit', 'unit'))
    if (unitName) {
      let id = text(field(row, '单元ID', 'unitId'))
      const key = id ? `id:${id}` : `name:${unitName}`
      const existing = groups.get(key)
      if (existing && existing.name !== unitName) throw new Error(`单元ID「${id}」对应了不同名称。`)
      if (!id && !existing) {
        let serial = groups.size + 1
        do { id = `unit-${String(serial++).padStart(2, '0')}` } while (usedIds.has(id))
        usedIds.add(id)
      }
      const group = existing ?? { id, name: unitName, words: [] }
      if (!group.words.some(w => normalizeLearningWord(w) === normalizeLearningWord(word.word))) group.words.push(word.word!)
      groups.set(key, group)
    }
    if (field(row, '笔记', 'note')) warnings.push('表格中的个人笔记未加入公共词书。')
  }
  content.units = [...groups.values()]
  return finish(content, warnings)
}

export function parseLibraryImport(raw: string, format: 'json' | 'txt', name = '导入词书'): LibraryImportResult {
  if (format === 'txt') {
    const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim())
    const header = lines[0]?.split('\t').map(text) ?? []
    if (header.length > 1 && ['单词', 'word'].includes(header[0])) {
      return parseLibraryRows(lines.slice(1).map(line => {
        const cells = line.split('\t')
        return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']))
      }), name)
    }
    return parseLibraryRows(lines.map(line => {
      const [word, ...meaning] = line.split('\t'); return { word, trans: meaning.join('\t') }
    }), name)
  }
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  if (parsed?.format === 'typewords-units') {
    const unitBook = parseUnitImport(JSON.stringify(parsed))!
    const result = finish({ ...emptyLibraryContent(), name: unitBook.name || name, words: unitBook.words, units: unitBook.units })
    result.duplicates = parsed.units.reduce((total: number, unit: { words: unknown[] }) => total + unit.words.length, 0) - unitBook.words.length
    return result
  }
  if (Array.isArray(parsed)) return parseLibraryRows(parsed.map(v => typeof v === 'string' ? { word: v } : v), name)
  const data = parsed?.content ?? parsed
  if (!data || typeof data !== 'object' || !Array.isArray(data.words)) throw new Error('JSON需要词条数组、单元JSON或包含words的词书对象。')
  const result = parseLibraryRows(data.words.map(v => typeof v === 'string' ? { word: v } : v), text(data.name) || name)
  for (const key of ['description', 'category', 'language', 'translateLanguage', 'cover']) if (typeof data[key] === 'string') result.content[key] = data[key]
  if (Array.isArray(data.tags)) result.content.tags = data.tags.filter(v => typeof v === 'string')
  result.content.recommended = data.recommended === true
  result.content.sortOrder = Number.isFinite(data.sortOrder) ? data.sortOrder : 0
  if (data.units !== undefined) {
    const ids = new Set<string>()
    result.content.units = array(data.units).map(value => {
      const unit = record(value)
      const id = text(unit.id)
      const name = text(unit.name)
      if (!id || !name) throw new Error('单元ID和名称不能为空。')
      if (ids.has(id)) throw new Error(`单元ID「${id}」重复。`)
      ids.add(id)
      const members = new Map<string, string>()
      for (const value of array(unit.words)) {
        const word = text(value)
        if (!word) throw new Error('单元成员不能为空。')
        if (!members.has(normalizeLearningWord(word))) members.set(normalizeLearningWord(word), word)
      }
      return { id, name, words: [...members.values()] }
    })
  }
  return result
}
