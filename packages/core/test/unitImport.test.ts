import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUnitImport } from '../src/utils/unitImport.ts'

function content(value: unknown): string {
  return JSON.stringify(value)
}

test('parses mixed string and detailed words while keeping safe native fields', () => {
  const result = parseUnitImport(content({
    format: 'typewords-units',
    version: 1,
    name: ' CET 词书 ',
    units: [{
      name: ' Lesson 1 ',
      words: [
        ' Alpha ',
        {
          word: 'Beta',
          phonetic0: '/beɪtə/',
          trans: [{ pos: 'n.', cn: '贝塔', frequency: 2 }],
          sentences: [{ c: 'Beta test.', cn: '贝塔测试。' }],
          id: 'outside-id',
          custom: true,
        },
      ],
    }],
  }))

  assert.deepEqual(result, {
    name: 'CET 词书',
    units: [{ id: 'unit-01', name: 'Lesson 1', words: ['Alpha', 'Beta'] }],
    words: [
      { word: 'Alpha' },
      {
        word: 'Beta',
        phonetic0: '/beɪtə/',
        trans: [{ pos: 'n.', cn: '贝塔', frequency: 2 }],
        sentences: [{ c: 'Beta test.', cn: '贝塔测试。' }],
      },
    ],
    lookupWords: ['Alpha'],
  })
})

test('shared words remain members of every unit while the full word list stays first-seen', () => {
  const result = parseUnitImport(content({
    format: 'typewords-units',
    version: 1,
    units: [
      { id: 'one', name: '第一课', words: ['Shared', 'First'] },
      {
        id: 'two',
        name: '第二课',
        words: [
          'Second',
          { word: ' shared ', trans: [{ pos: 'adj.', cn: '共享的' }] },
        ],
      },
    ],
  }))

  assert.ok(result)
  assert.deepEqual(result.units, [
    { id: 'one', name: '第一课', words: ['Shared', 'First'] },
    { id: 'two', name: '第二课', words: ['Second', 'shared'] },
  ])
  assert.deepEqual(result.words, [
    { word: 'Shared', trans: [{ pos: 'adj.', cn: '共享的' }] },
    { word: 'First' },
    { word: 'Second' },
  ])
  assert.deepEqual(result.lookupWords, ['First', 'Second'])
})

test('words without definitions are retained and reported only as lookup words', () => {
  const result = parseUnitImport(content({
    format: 'typewords-units',
    version: 1,
    units: [{ id: 'u', name: '一课', words: ['Missing', 'Still Here'] }],
  }))

  assert.ok(result)
  assert.deepEqual(result.units[0].words, ['Missing', 'Still Here'])
  assert.deepEqual(result.words, [{ word: 'Missing' }, { word: 'Still Here' }])
  assert.deepEqual(result.lookupWords, ['Missing', 'Still Here'])
})

test('rejects unsupported versions, duplicate ids, empty units, and invalid word fields', () => {
  assert.throws(() => parseUnitImport(content({
    format: 'typewords-units', version: 2, units: [],
  })), /version/)
  assert.throws(() => parseUnitImport(content({
    format: 'typewords-units',
    version: 1,
    units: [
      { id: 'same', name: '一', words: ['Alpha'] },
      { id: 'same', name: '二', words: ['Beta'] },
    ],
  })), /重复/)
  assert.throws(() => parseUnitImport(content({
    format: 'typewords-units', version: 1, units: [{ name: '空课', words: [] }],
  })), /空/)
  assert.throws(() => parseUnitImport(content({
    format: 'typewords-units',
    version: 1,
    units: [{ name: '字段错误', words: [{ word: 'Alpha', trans: {} }] }],
  })), /trans.*数组/)
})

test('returns null for the legacy top-level array', () => {
  assert.equal(parseUnitImport(content(['Alpha', { word: 'Beta' }])), null)
})
