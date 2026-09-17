import type { Dict, Word } from '../types'
import { VOCABULARY6000_FALLBACK_WORDS, VOCABULARY6000_LESSONS } from '../data/vocabulary6000'
import { normalizeLearningWord } from './bookLearning'

const sourceKeys = new Set(VOCABULARY6000_LESSONS.flatMap(unit => unit.words.map(normalizeLearningWord)))
const fallbackKeys = new Set(VOCABULARY6000_FALLBACK_WORDS.map(word => normalizeLearningWord(word.word)))

/** Only offer the profile for a complete source book, allowing the three known lookup gaps. */
export function matchesVocabulary6000(dict: Dict): boolean {
  if (!dict.custom || dict.system || dict.units?.length) return false
  const keys = dict.words.map(word => normalizeLearningWord(word.word))
  const present = new Set(keys)
  return (
    present.size === keys.length &&
    present.size >= sourceKeys.size - fallbackKeys.size &&
    keys.every(key => sourceKeys.has(key)) &&
    [...sourceKeys].every(key => present.has(key) || fallbackKeys.has(key))
  )
}

export function getVocabulary6000Repairs(dict: Dict): Partial<Word>[] {
  const words = new Map(dict.words.map(word => [normalizeLearningWord(word.word), word]))
  return VOCABULARY6000_FALLBACK_WORDS.filter(source => {
    const existing = words.get(normalizeLearningWord(source.word))
    return !existing || !existing.trans?.length || (!existing.custom && existing.word !== source.word)
  })
}

export function createVocabulary6000Units() {
  return VOCABULARY6000_LESSONS.map(unit => ({ id: unit.id, name: unit.name, words: [...unit.words] }))
}
