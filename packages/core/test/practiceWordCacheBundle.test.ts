import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPracticeWordCacheFromPayload,
  mergePracticeWordCacheBundles,
  normalizePracticeWordCacheBundle,
} from '../src/utils/cache.ts'

const cache = (dictId: string) => ({ dictId, taskWords: { new: [], review: [] } })

test('an empty legacy cloud row preserves both local tasks and completed-task tombstones', () => {
  const local = normalizePracticeWordCacheBundle(cache('book-a'), '2026-09-14T00:00:00.000Z')!
  local.entries['book-b'] = { data: null, updatedAt: '2026-09-13T00:00:00.000Z' }
  for (const remoteTimestamp of ['2026-09-01T00:00:00.000Z', '2026-09-15T00:00:00.000Z']) {
    const merged = mergePracticeWordCacheBundles(local, null, '2026-09-14T00:00:00.000Z', remoteTimestamp)
    assert.deepEqual(merged, local)
  }
})

test('legacy single-dictionary cache migrates into a v2 bundle', () => {
  const migrated = normalizePracticeWordCacheBundle(cache('book-a'), '2026-01-01T00:00:00.000Z')!
  assert.equal(migrated.schemaVersion, 2)
  assert.equal(migrated.entries['book-a'].data?.dictId, 'book-a')
  assert.equal(migrated.entries['book-a'].updatedAt, '2026-01-01T00:00:00.000Z')
})

test('legacy cache without a dictionary remains unresolved instead of being assigned incorrectly', () => {
  const migrated = normalizePracticeWordCacheBundle({ taskWords: { new: [], review: [] } } as any)!
  assert.deepEqual(migrated.entries, {})
  assert.equal(migrated.unresolvedLegacy?.data?.dictId, undefined)
})

test('bundle merge retains independent dictionaries and favors local data on equal timestamps', () => {
  const local = normalizePracticeWordCacheBundle(cache('book-a'), '2026-01-02T00:00:00.000Z')!
  const remote = normalizePracticeWordCacheBundle(cache('book-b'), '2026-01-03T00:00:00.000Z')!
  const combined = mergePracticeWordCacheBundles(local, remote)!
  assert.deepEqual(Object.keys(combined.entries).sort(), ['book-a', 'book-b'])

  const remoteSameBook = normalizePracticeWordCacheBundle(
    { ...cache('book-a'), marker: 'remote' } as any,
    '2026-01-02T00:00:00.000Z'
  )!
  const localSameBook = normalizePracticeWordCacheBundle(
    { ...cache('book-a'), marker: 'local' } as any,
    '2026-01-02T00:00:00.000Z'
  )!
  const tie = mergePracticeWordCacheBundles(localSameBook, remoteSameBook)!
  assert.equal((tie.entries['book-a'].data as any).marker, 'local')
})

test('a newer tombstone survives merge and does not resurrect an unfinished session', () => {
  const local = {
    schemaVersion: 2 as const,
    entries: { 'book-a': { data: cache('book-a'), updatedAt: '2026-01-01T00:00:00.000Z' } },
  }
  const remote = {
    schemaVersion: 2 as const,
    entries: { 'book-a': { data: null, updatedAt: '2026-01-02T00:00:00.000Z' } },
  }
  const merged = mergePracticeWordCacheBundles(local, remote)!
  assert.equal(merged.entries['book-a'].data, null)
  assert.equal(getPracticeWordCacheFromPayload(merged, 'book-a'), null)
})
