import assert from 'node:assert/strict'
import test from 'node:test'
import {
  crossedPracticeTimeSaveInterval,
  getPracticeTimeDays,
  getPracticeTimerCutoff,
  initializePracticeTimeAccounting,
  resetPracticeTimeAccounting,
  startPracticeTimeSegment,
  stripPracticeTimeAccounting,
  syncPracticeTime,
  type PracticeTimeSource,
} from '../src/utils/practiceTime.ts'

process.env.TZ = 'Asia/Shanghai'

function total(days: ReturnType<typeof getPracticeTimeDays>): number {
  return days.reduce((sum, day) => sum + day.spend, 0)
}

test('legacy segments preserve the saved 91-minute total instead of expanding to raw wall time', () => {
  const start = Date.parse('2026-09-02T10:00:00+08:00')
  const source: PracticeTimeSource = {
    startDate: start,
    spend: 5_463_000,
    segments: [[start, start + 6_775_957]],
  }
  const originalSegments = JSON.parse(JSON.stringify(source.segments))

  const days = getPracticeTimeDays(source)

  assert.equal(total(days), 5_463_000)
  assert.deepEqual(source.segments, originalSegments)
  assert.equal(days[0].spend, 5_463_000)
})

test('cross-midnight segments split by local calendar day while preserving the exact total', () => {
  const start = Date.parse('2026-09-10T23:59:00+08:00')
  const source: PracticeTimeSource = {
    startDate: start,
    spend: 120_000,
    segments: [[start, start + 120_000]],
    timeAccounting: { version: 1, legacySegmentCount: 0, legacySpend: 0 },
  }

  const days = getPracticeTimeDays(source)

  assert.deepEqual(days.map(day => [day.dateKey, day.spend]), [
    ['2026-09-10', 60_000],
    ['2026-09-11', 60_000],
  ])
  assert.equal(total(days), source.spend)
})

test('restoring a legacy cache and resuming later does not count the offline interval', () => {
  const source: PracticeTimeSource = {
    startDate: 0,
    spend: 91_000,
    segments: [[0, 113_000]],
  }

  initializePracticeTimeAccounting(source, true)
  startPracticeTimeSegment(source, 1_000_000)
  syncPracticeTime(source, 1_001_000)

  assert.equal(source.spend, 92_000)
  assert.equal(total(getPracticeTimeDays(source)), 92_000)
})

test('legacy spend without segments stays on its original day after a later resume', () => {
  const legacyStart = Date.parse('2026-09-02T10:00:00+08:00')
  const resumedAt = Date.parse('2026-09-10T10:00:00+08:00')
  const source: PracticeTimeSource = {
    startDate: legacyStart,
    spend: 91_000,
    segments: [],
  }

  initializePracticeTimeAccounting(source, true)
  startPracticeTimeSegment(source, resumedAt)
  syncPracticeTime(source, resumedAt + 1_000)

  assert.deepEqual(getPracticeTimeDays(source).map(day => [day.dateKey, day.spend]), [
    ['2026-09-02', 91_000],
    ['2026-09-10', 1_000],
  ])
})

test('a delayed timer is capped at the three-minute idle deadline', () => {
  const source: PracticeTimeSource = { startDate: 0, spend: 0, segments: [] }
  resetPracticeTimeAccounting(source)
  startPracticeTimeSegment(source, 0)
  const cutoff = getPracticeTimerCutoff(300_000, 0, 180_000)
  syncPracticeTime(source, cutoff)

  assert.equal(cutoff, 180_000)
  assert.equal(source.spend, 180_000)
})

test('a late activity event can begin a fresh segment without counting the background gap', () => {
  const source: PracticeTimeSource = { startDate: 0, spend: 0, segments: [] }
  resetPracticeTimeAccounting(source)
  startPracticeTimeSegment(source, 0)
  syncPracticeTime(source, getPracticeTimerCutoff(300_000, 0, 180_000))
  startPracticeTimeSegment(source, 300_000)
  syncPracticeTime(source, 301_000)

  assert.equal(source.spend, 181_000)
})

test('practice autosave fires once when 1003ms ticks cross 30 seconds and not when time resets', () => {
  let previous = 0
  let saves = 0
  for (let current = 1_003; current <= 31_093; current += 1_003) {
    if (crossedPracticeTimeSaveInterval(previous, current)) saves++
    previous = current
  }

  assert.equal(saves, 1)
  assert.equal(crossedPracticeTimeSaveInterval(29_087, 30_090), true)
  assert.equal(crossedPracticeTimeSaveInterval(30_090, 0), false)
})

test('legacy-runtime serialization strips a copied marker so a later Nuxt restore uses the new round spend', () => {
  const original: PracticeTimeSource = {
    startDate: 0,
    spend: 1_000,
    segments: [[0, 1_000]],
    timeAccounting: { version: 1, legacySegmentCount: 0, legacySpend: 91_000 },
  }

  const persisted = stripPracticeTimeAccounting(original)

  assert.notStrictEqual(persisted, original)
  assert.deepEqual(original.timeAccounting, { version: 1, legacySegmentCount: 0, legacySpend: 91_000 })
  assert.equal(persisted.timeAccounting, undefined)
  assert.equal(initializePracticeTimeAccounting(persisted, true).legacySpend, 1_000)
})

test('zero saved time never creates a calendar day from raw segments', () => {
  const source: PracticeTimeSource = {
    startDate: Date.parse('2026-09-10T10:00:00+08:00'),
    spend: 0,
    segments: [[Date.parse('2026-09-10T10:00:00+08:00'), Date.parse('2026-09-10T10:01:00+08:00')]],
  }

  assert.deepEqual(getPracticeTimeDays(source), [])
})
