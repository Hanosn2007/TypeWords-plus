import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute the production push function with storage/network replaced by spies.
const source = readFileSync(new URL('../src/composables/useDataSyncPersistence.ts', import.meta.url), 'utf8')
const start = source.indexOf('  async function pushSnapshotToRemote(')
const end = source.indexOf('  async function forcePushLocalDataToRemote(', start)
const js = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

test('cloud autosave delegates to the safe coordinator without calling the legacy overwrite path', async () => {
  const writes = []
  const uploads = []
  let scheduled = 0
  const bundle = { schemaVersion: 2, entries: { book: { data: { progress: 39 }, updatedAt: '2026-09-14T00:12:11.015Z' } } }
  const deps = {
    CloudSync: { check: () => true }, Supabase: { check: () => false },
    SyncDataType: { practice_word: 'practice_word' },
    fetchServerDatas: async () => [{ data: null, updated_at: '2026-09-01T10:14:14.603399388Z' }],
    persistLocalState: async (...args) => writes.push(args),
    upsertServerDatas: async rows => { uploads.push(rows); return true },
    getDataVersion: () => 1, setSyncStatus: () => {},
    scheduleSafeSync: () => { scheduled++ },
  }
  const push = new Function(...Object.keys(deps), js + ';return pushSnapshotToRemote;')(...Object.values(deps))
  let merges = 0
  const ok = await push('practice_word', bundle, '2026-09-14T00:12:11.015Z', null, false, async remote => {
    merges++
    assert.equal(remote, null)
    return bundle
  })
  assert.equal(ok, true)
  assert.equal(merges, 0)
  assert.equal(uploads.length, 0)
  assert.equal(scheduled, 1)
  assert.equal(writes.length, 0)
})
