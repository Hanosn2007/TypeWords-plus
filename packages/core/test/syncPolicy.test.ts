import assert from 'node:assert/strict'
import test from 'node:test'
import { decideSync, normalizeSyncRows, rowsSignature, rowsSignatureAsync } from '../src/utils/syncPolicy.ts'
const rows = (n: number) => normalizeSyncRows([{ type: 'dict', data_version: 4, data: { word: { bookList: [{ id: 'mine', lastLearnIndex: n }] } } }])
test('first login never chooses old cloud over meaningful local progress', () => {
  assert.equal(decideSync(rows(1000), { revision: 1, rows: rows(900) }), 'conflict')
  assert.equal(decideSync(rows(1000), { revision: 0, rows: [] }), 'push')
})
test('baseline identifies one-sided changes and concurrent edits without comparing client clocks', () => {
  const baseline = { revision: 3, signature: rowsSignature(rows(900)) }
  assert.equal(decideSync(rows(1000), { revision: 3, rows: rows(900) }, baseline), 'push')
  assert.equal(decideSync(rows(900), { revision: 4, rows: rows(1000) }, baseline), 'pull')
  assert.equal(decideSync(rows(1000), { revision: 4, rows: rows(1100) }, baseline), 'conflict')
  assert.equal(decideSync(rows(1000), { revision: 4, rows: rows(1000) }, baseline), 'same')
})
test('switching account requires explicit choice even for an empty cloud', () => {
  assert.equal(decideSync(rows(1000), { revision: 0, rows: [] }, undefined, true), 'conflict')
})

test('cooperative signatures remain byte-for-byte compatible with persisted baselines', async () => {
  const fixtures: any[] = [[], rows(1000), [
    { type: 'dict', data_version: 4, data: { load: true, _ignoreWatch: false, unicode: '单词', z: [null, undefined, NaN, Infinity], a: { omitted: undefined, date: new Date('2026-09-16T00:00:00Z') } } },
    { type: 'setting', data: { load: false, theme: 'dark' } },
  ]]
  for (const fixture of fixtures) assert.equal(await rowsSignatureAsync(fixture), rowsSignature(fixture))
})

test('large signatures yield to input processing while preserving complete content', async () => {
  const fixture = [{ type: 'dict', data_version: 4, data: { words: Array.from({ length: 8000 }, (_, i) => ({ word: 'word-' + i, translation: 'example'.repeat(10), score: i })) } }]
  let turns = 0
  const signature = await rowsSignatureAsync(fixture, async () => { turns++; await new Promise<void>(resolve => setTimeout(resolve, 0)) })
  assert.ok(turns > 0)
  assert.equal(signature, rowsSignature(fixture))
})
