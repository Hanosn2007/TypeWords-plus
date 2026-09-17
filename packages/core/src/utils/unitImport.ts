import { normalizeLearningWord } from './bookLearning.ts'
import type { BookUnit, Word } from '../types/types'

export type UnitImportResult = {
  name: string
  units: BookUnit[]
  words: Partial<Word>[]
  lookupWords: string[]
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function importError(message: string): never {
  throw new Error(`单元 JSON 格式错误：${message}`)
}

function requiredString(value: unknown, label: string, trim = false): string {
  if (typeof value !== 'string') importError(`${label}必须是字符串`)
  const result = trim ? value.trim() : value
  if (!result) importError(`${label}不能为空`)
  return result
}

function optionalString(source: JsonRecord, key: 'phonetic0' | 'phonetic1', label: string): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') importError(`${label}必须是字符串`)
  return value
}

function readTranslations(value: unknown, label: string): Word['trans'] {
  if (!Array.isArray(value)) importError(`${label}必须是数组`)
  return value.map((item, index) => {
    if (!isRecord(item)) importError(`${label}第 ${index + 1} 项必须是对象`)
    const result: Word['trans'][number] = {
      pos: requiredString(item.pos, `${label}第 ${index + 1} 项的 pos`),
      cn: requiredString(item.cn, `${label}第 ${index + 1} 项的 cn`),
    }
    if (item.frequency !== undefined) {
      if (typeof item.frequency !== 'number' || !Number.isInteger(item.frequency) || item.frequency < 0 || item.frequency > 2) {
        importError(`${label}第 ${index + 1} 项的 frequency 必须是 0、1 或 2`)
      }
      result.frequency = item.frequency
    }
    return result
  })
}

function readTextPairs(value: unknown, label: string): { c: string; cn: string }[] {
  if (!Array.isArray(value)) importError(`${label}必须是数组`)
  return value.map((item, index) => {
    if (!isRecord(item)) importError(`${label}第 ${index + 1} 项必须是对象`)
    return {
      c: requiredString(item.c, `${label}第 ${index + 1} 项的 c`),
      cn: requiredString(item.cn, `${label}第 ${index + 1} 项的 cn`),
    }
  })
}

function readSynonyms(value: unknown, label: string): Word['synos'] {
  if (!Array.isArray(value)) importError(`${label}必须是数组`)
  return value.map((item, index) => {
    if (!isRecord(item)) importError(`${label}第 ${index + 1} 项必须是对象`)
    if (!Array.isArray(item.ws) || item.ws.some(word => typeof word !== 'string')) {
      importError(`${label}第 ${index + 1} 项的 ws 必须是字符串数组`)
    }
    return {
      pos: requiredString(item.pos, `${label}第 ${index + 1} 项的 pos`),
      cn: requiredString(item.cn, `${label}第 ${index + 1} 项的 cn`),
      ws: [...item.ws],
    }
  })
}

function readRelatedWords(value: unknown, label: string): Word['relWords'] {
  if (!isRecord(value)) importError(`${label}必须是对象`)
  if (!Array.isArray(value.rels)) importError(`${label}.rels 必须是数组`)
  return {
    root: requiredString(value.root, `${label}.root`),
    rels: value.rels.map((relation, relationIndex) => {
      if (!isRecord(relation)) importError(`${label}.rels 第 ${relationIndex + 1} 项必须是对象`)
      if (!Array.isArray(relation.words)) importError(`${label}.rels 第 ${relationIndex + 1} 项的 words 必须是数组`)
      return {
        pos: requiredString(relation.pos, `${label}.rels 第 ${relationIndex + 1} 项的 pos`),
        words: relation.words.map((word, wordIndex) => {
          if (!isRecord(word)) importError(`${label}.rels 第 ${relationIndex + 1} 项的 words 第 ${wordIndex + 1} 项必须是对象`)
          return {
            c: requiredString(word.c, `${label}.rels 第 ${relationIndex + 1} 项的 words 第 ${wordIndex + 1} 项的 c`),
            cn: requiredString(word.cn, `${label}.rels 第 ${relationIndex + 1} 项的 words 第 ${wordIndex + 1} 项的 cn`),
          }
        }),
      }
    }),
  }
}

function readEtymology(value: unknown, label: string): Word['etymology'] {
  if (!Array.isArray(value)) importError(`${label}必须是数组`)
  return value.map((item, index) => {
    if (!isRecord(item)) importError(`${label}第 ${index + 1} 项必须是对象`)
    return {
      t: requiredString(item.t, `${label}第 ${index + 1} 项的 t`),
      d: requiredString(item.d, `${label}第 ${index + 1} 项的 d`),
    }
  })
}

function parseWord(value: unknown, label: string): Partial<Word> {
  if (typeof value === 'string') return { word: requiredString(value, label, true) }
  if (!isRecord(value)) importError(`${label}必须是字符串或词条对象`)

  const result: Partial<Word> = { word: requiredString(value.word, `${label}的 word`, true) }
  const phonetic0 = optionalString(value, 'phonetic0', `${label}的 phonetic0`)
  const phonetic1 = optionalString(value, 'phonetic1', `${label}的 phonetic1`)
  if (phonetic0 !== undefined) result.phonetic0 = phonetic0
  if (phonetic1 !== undefined) result.phonetic1 = phonetic1
  if (value.trans !== undefined) result.trans = readTranslations(value.trans, `${label}的 trans`)
  if (value.sentences !== undefined) result.sentences = readTextPairs(value.sentences, `${label}的 sentences`)
  if (value.phrases !== undefined) result.phrases = readTextPairs(value.phrases, `${label}的 phrases`)
  if (value.synos !== undefined) result.synos = readSynonyms(value.synos, `${label}的 synos`)
  if (value.relWords !== undefined) result.relWords = readRelatedWords(value.relWords, `${label}的 relWords`)
  if (value.etymology !== undefined) result.etymology = readEtymology(value.etymology, `${label}的 etymology`)
  return result
}

function supplementWord(existing: Partial<Word>, incoming: Partial<Word>): void {
  if ((!existing.phonetic0 && incoming.phonetic0 !== undefined)) existing.phonetic0 = incoming.phonetic0
  if ((!existing.phonetic1 && incoming.phonetic1 !== undefined)) existing.phonetic1 = incoming.phonetic1
  if (!existing.trans?.length && incoming.trans?.length) existing.trans = incoming.trans
  if (!existing.sentences?.length && incoming.sentences?.length) existing.sentences = incoming.sentences
  if (!existing.phrases?.length && incoming.phrases?.length) existing.phrases = incoming.phrases
  if (!existing.synos?.length && incoming.synos?.length) existing.synos = incoming.synos
  if (
    (!existing.relWords || (!existing.relWords.root && !existing.relWords.rels.length)) &&
    incoming.relWords &&
    (incoming.relWords.root || incoming.relWords.rels.length)
  ) {
    existing.relWords = incoming.relWords
  }
  if (!existing.etymology?.length && incoming.etymology?.length) existing.etymology = incoming.etymology
}

function generatedUnitId(index: number, used: Set<string>): string {
  let serial = index
  let id = ''
  do {
    id = `unit-${String(serial).padStart(2, '0')}`
    serial++
  } while (used.has(id))
  used.add(id)
  return id
}

/**
 * Parses the TypeWords unit interchange format without doing lookups or
 * mutating a dictionary. Legacy top-level arrays deliberately return null so
 * the existing importer can handle them unchanged.
 */
export function parseUnitImport(content: string): UnitImportResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('单元 JSON 解析失败：不是有效的 JSON')
  }

  if (Array.isArray(parsed)) return null
  if (!isRecord(parsed)) importError('顶层必须是对象或旧版数组')
  if (parsed.format !== 'typewords-units') importError('format 必须是 "typewords-units"')
  if (parsed.version !== 1) importError('version 目前只支持 1')
  if (parsed.name !== undefined && typeof parsed.name !== 'string') importError('name 必须是字符串')
  if (!Array.isArray(parsed.units)) importError('units 必须是数组')
  if (!parsed.units.length) importError('units 不能为空')

  const explicitIds = new Set<string>()
  parsed.units.forEach((unit, index) => {
    if (!isRecord(unit)) importError(`第 ${index + 1} 个单元必须是对象`)
    if (unit.id === undefined) return
    const id = requiredString(unit.id, `第 ${index + 1} 个单元的 id`, true)
    if (explicitIds.has(id)) importError(`单元 id「${id}」重复`)
    explicitIds.add(id)
  })

  const ids = new Set(explicitIds)
  const units: BookUnit[] = []
  const words: Partial<Word>[] = []
  const wordsByKey = new Map<string, Partial<Word>>()
  let generatedIdIndex = 1

  parsed.units.forEach((unitValue, unitIndex) => {
    const unit = unitValue as JsonRecord
    const label = `第 ${unitIndex + 1} 个单元`
    const id = unit.id === undefined
      ? generatedUnitId(generatedIdIndex++, ids)
      : requiredString(unit.id, `${label}的 id`, true)
    const name = requiredString(unit.name, `${label}的 name`, true)
    if (!Array.isArray(unit.words)) importError(`${label}的 words 必须是数组`)
    if (!unit.words.length) importError(`${label}不能为空单元`)

    const members: string[] = []
    const memberKeys = new Set<string>()
    unit.words.forEach((value, wordIndex) => {
      const imported = parseWord(value, `${label}第 ${wordIndex + 1} 个词`)
      const originalWord = imported.word as string
      const key = normalizeLearningWord(originalWord)
      if (!key) importError(`${label}第 ${wordIndex + 1} 个词不能为空`)

      if (!memberKeys.has(key)) {
        memberKeys.add(key)
        members.push(originalWord)
      }

      const existing = wordsByKey.get(key)
      if (existing) {
        supplementWord(existing, imported)
      } else {
        wordsByKey.set(key, imported)
        words.push(imported)
      }
    })

    if (!members.length) importError(`${label}不能为空单元`)
    units.push({ id, name, words: members })
  })

  const lookupWords = words
    .filter(word => !word.trans?.length)
    .map(word => word.word as string)
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  return { name, units, words, lookupWords }
}
