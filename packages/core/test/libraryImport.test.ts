import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parseLibraryImport, parseLibraryRows } from '../src/utils/libraryImport.ts'
import { VOCABULARY6000_LESSONS } from '../src/data/vocabulary6000.ts'

const json = (value: unknown) => parseLibraryImport(JSON.stringify(value), 'json')

test('plain JSON arrays retain missing definitions for administrator completion', () => {
  const result = json([' Alpha ', { word: 'Beta', trans: [{ pos: 'n.', cn: '贝塔' }] }])
  assert.deepEqual(result.content.words.map(word => word.word), ['Alpha', 'Beta'])
  assert.equal(result.missingDefinitions, 1)
  assert.equal(result.duplicates, 0)
  assert.equal(json([{ word: 'alpha', id: 123 }]).content.words[0].id, '123')
})

test('rich native fields survive public JSON import and source objects stay untouched', () => {
  const word = {
    id: 'stable-word', word: 'abide', phonetic0: 'əˈbaɪd', phonetic1: 'əˈbaɪd',
    trans: [{ pos: 'vi.', cn: '遵守', frequency: 2 }],
    sentences: [{ c: 'Abide by the rules.', cn: '遵守规则。' }],
    phrases: [{ c: 'abide by', cn: '遵守' }],
    synos: [{ pos: 'v.', cn: '遵守', ws: ['follow', 'obey'] }],
    relWords: { root: 'abide', rels: [{ pos: 'adj.', words: [{ c: 'abiding', cn: '持久的' }] }] },
    etymology: [{ t: '来源', d: '词源说明' }],
  }
  const result = json([word])
  assert.deepEqual(result.content.words, [word])
  result.content.words[0].synos![0].ws.push('changed')
  assert.deepEqual(word.synos[0].ws, ['follow', 'obey'])
})

test('public import removes personal notes and learning state at every structured level', () => {
  const result = json({
    name: 'Public', noteData: { alpha: 'secret' }, learning: { fsrs: 'private' },
    words: [{
      word: 'alpha', note: 'private', custom: true, learning: { fsrs: 'private' },
      trans: [{ pos: 'n.', cn: '阿尔法', note: 'private' }],
      sentences: [{ c: 'Alpha.', cn: '阿尔法。', note: 'private' }],
      synos: [{ pos: 'n.', cn: '第一', ws: ['first'], note: 'private' }],
      relWords: { root: 'alpha', note: 'private', rels: [{ pos: 'n.', note: 'private', words: [{ c: 'alpha', cn: '第一', note: 'private' }] }] },
      etymology: [{ t: '来源', d: '希腊字母', note: 'private' }],
    }],
    units: [{ id: 'u1', name: 'Lesson 1', words: ['alpha'], learning: 'private' }],
  })
  assert.doesNotMatch(JSON.stringify(result.content), /private|secret|noteData|learning|custom|"note"/)
  assert.ok(result.warnings.some(warning => warning.includes('个人笔记')))
  assert.equal(result.content.words[0].etymology![0].d, '希腊字母')
})

test('workbook rows parse rich multiline fields and ignore the private note column', () => {
  const result = parseLibraryRows([{
    单词: ' abide ', '音标①': 'əˈbaɪd', '音标②': 'əˈbaɪd', 翻译: 'vi. 遵守\nvt. 忍受',
    例句: 'Abide by the rules.\n遵守规则。\n\nI cannot abide it.\n我无法忍受。',
    短语: 'abide by\n遵守', 近义词: 'v. 遵守\nfollow/obey',
    同根词: '词根：abide\nadj.:\nabiding: 持久的', 词源: '来源\n词源说明',
    单元: 'Lesson 1', 单元ID: 'lesson-1', 笔记: 'private',
  }])
  const word = result.content.words[0]
  assert.deepEqual(word.trans, [{ pos: 'vi.', cn: '遵守' }, { pos: 'vt.', cn: '忍受' }])
  assert.equal(word.sentences?.length, 2)
  assert.deepEqual(word.phrases, [{ c: 'abide by', cn: '遵守' }])
  assert.deepEqual(word.synos, [{ pos: 'v.', cn: '遵守', ws: ['follow', 'obey'] }])
  assert.deepEqual(word.relWords, { root: 'abide', rels: [{ pos: 'adj.', words: [{ c: 'abiding', cn: '持久的' }] }] })
  assert.deepEqual(word.etymology, [{ t: '来源', d: '词源说明' }])
  assert.deepEqual(result.content.units, [{ id: 'lesson-1', name: 'Lesson 1', words: ['abide'] }])
  assert.doesNotMatch(JSON.stringify(result.content), /private|笔记/)
})

test('row deduplication supplements rich content without dropping cross-unit membership', () => {
  const result = parseLibraryRows([
    { word: 'Shared', trans: [{ pos: '', cn: '' }], relWords: { root: '', rels: [] }, unit: 'One' },
    { word: 'First', trans: '第一', unit: 'One' },
    { word: ' shared ', trans: '共享', relWords: { root: 'share', rels: [] }, unit: 'Two' },
    { word: 'SHARED', unit: 'Two' },
  ])
  assert.equal(result.duplicates, 2)
  assert.equal(result.missingDefinitions, 0)
  assert.deepEqual(result.content.words.map(word => word.word), ['Shared', 'First'])
  assert.deepEqual(result.content.units.map(unit => unit.words), [['Shared', 'First'], ['shared']])
  assert.equal(result.content.words[0].trans![0].cn, '共享')
  assert.equal(result.content.words[0].relWords!.root, 'share')
})

test('explicit unit identity is preserved and generated ids avoid collisions', () => {
  const result = parseLibraryRows([
    { word: 'a', unit: 'Same', unitId: 'one' },
    { word: 'b', unit: 'Same', unitId: 'two' },
    { word: 'c', unit: 'Automatic' },
    { word: 'd', unit: 'Explicit', unitId: 'unit-03' },
  ])
  assert.deepEqual(result.content.units.map(unit => unit.id), ['one', 'two', 'unit-04', 'unit-03'])
  assert.throws(() => parseLibraryRows([
    { word: 'a', unit: 'One', unitId: 'same' }, { word: 'b', unit: 'Two', unitId: 'same' },
  ]), /不同名称/)
})

test('Unit JSON retains lesson order and supplements shared words without leaking notes', () => {
  const result = json({ format: 'typewords-units', version: 1, name: ' Course ', units: [
    { id: 'u1', name: 'One', words: ['Shared', 'First'] },
    { id: 'u2', name: 'Two', words: [{ word: 'shared', trans: [{ pos: 'adj.', cn: '共享的' }], note: 'private' }] },
  ] })
  assert.equal(result.content.name, 'Course')
  assert.equal(result.duplicates, 1)
  assert.equal(result.missingDefinitions, 1)
  assert.deepEqual(result.content.units.map(unit => unit.words), [['Shared', 'First'], ['shared']])
  assert.equal(result.content.words[0].trans![0].cn, '共享的')
  assert.doesNotMatch(JSON.stringify(result.content), /private/)
})

test('TSV supports BOM, CRLF, bare word lists and an optional header with units', () => {
  const plain = parseLibraryImport('\uFEFFalpha\t阿尔法\r\nbeta\t贝塔\r\n\r\nmissing', 'txt')
  assert.deepEqual(plain.content.words.map(word => word.word), ['alpha', 'beta', 'missing'])
  assert.equal(plain.missingDefinitions, 1)
  const table = parseLibraryImport('单词\t翻译\t单元\t笔记\nalpha\t阿尔法\tOne\tprivate\nalpha\t阿尔法\tTwo\tprivate', 'txt')
  assert.equal(table.duplicates, 1)
  assert.equal(table.content.words.length, 1)
  assert.deepEqual(table.content.units.map(unit => unit.words), [['alpha'], ['alpha']])
  assert.doesNotMatch(JSON.stringify(table.content), /private/)
})

test('full release wrappers preserve metadata and normalize members within each unit only', () => {
  const result = json({ id: 'outside-book', version: 8, content: {
    name: 'Course', description: 'Description', category: '课程', language: 'en', translateLanguage: 'zh-CN',
    tags: ['英语'], recommended: true, sortOrder: 3, cover: '/cover.png',
    words: [{ word: 'alpha', trans: '阿尔法' }],
    units: [{ id: 'u1', name: 'One', words: ['alpha', ' ALPHA '] }, { id: 'u2', name: 'Two', words: ['alpha'] }],
  } })
  assert.equal(result.content.description, 'Description')
  assert.equal(result.content.cover, '/cover.png')
  assert.equal(result.content.recommended, true)
  assert.equal(result.content.sortOrder, 3)
  assert.deepEqual(result.content.tags, ['英语'])
  assert.deepEqual(result.content.units.map(unit => unit.words), [['alpha'], ['alpha']])
  assert.equal('version' in result.content, false)
})

test('bad JSON, word shapes, nested fields and malformed units are rejected before saving', () => {
  assert.throws(() => parseLibraryImport('{broken', 'json'), SyntaxError)
  for (const invalid of [null, 42, {}, [null], [42], [[1]], [{ word: 42 }], [{ word: 'a', trans: {} }],
    [{ word: 'a', trans: [null] }], [{ word: 'a', trans: [{ cn: {}, pos: 'n.' }] }],
    [{ word: 'a', trans: [{ cn: 'a', frequency: 3 }] }], [{ word: 'a', sentences: [null] }],
    [{ word: 'a', synos: [{ ws: 'wrong' }] }], [{ word: 'a', relWords: { rels: {} } }],
    { words: ['a'], units: {} }, { words: ['a'], units: [{ id: 'u', name: 'Unit', words: [42] }] },
    { words: ['a'], units: [{ id: 'u', name: 'One', words: ['a'] }, { id: 'u', name: 'Two', words: ['a'] }] },
    { format: 'typewords-units', version: 2, units: [] },
  ]) assert.throws(() => json(invalid), undefined, JSON.stringify(invalid))
})

test('Vocabulary 6000 candidate retains the exact 31-lesson sequence with complete definitions', () => {
  const candidate = JSON.parse(readFileSync(new URL('../../../data/library/vocabulary6000.json', import.meta.url), 'utf8'))
  const result = json(candidate)
  assert.deepEqual(result.content, candidate)
  assert.equal(result.duplicates, 0)
  assert.equal(result.missingDefinitions, 0)
  assert.equal(candidate.words.length, 1240)
  assert.deepEqual(candidate.units, VOCABULARY6000_LESSONS)
  assert.ok(candidate.units.every(unit => unit.words.length === 40))
  assert.deepEqual(candidate.words.map(word => word.word), candidate.units.flatMap(unit => unit.words))
  assert.ok(candidate.words.every(word => word.trans.every(translation => translation.cn.trim())))
  assert.equal(candidate.words.reduce((total, word) => total + word.sentences.length, 0), 1416)
  assert.equal(/"(?:note|noteData|learning|fsrs|custom|statistics)"\s*:/.test(JSON.stringify(candidate)), false)
})
