export type PracticeTimeSegment = [number, number]

/** Separates immutable pre-upgrade segments from segments recorded by the unified timer. */
export type PracticeTimeAccounting = {
  version: 1
  legacySegmentCount: number
  legacySpend: number
}

export type PracticeTimeSource = {
  startDate?: number
  spend?: number
  segments?: PracticeTimeSegment[]
  timeAccounting?: PracticeTimeAccounting
}

export type PracticeTimeDay = {
  dateKey: string
  startDate: number
  spend: number
  segments: PracticeTimeSegment[]
}

/**
 * Makes a legacy-runtime snapshot safe to persist without changing the live
 * store state. The accounting marker is meaningful only to the Nuxt unified
 * timer; older clients must let a later Nuxt restore treat their saved spend
 * as one complete legacy baseline.
 */
export function stripPracticeTimeAccounting<T extends PracticeTimeSource>(source: T): T {
  const { timeAccounting: _timeAccounting, ...snapshot } = source
  return snapshot as T
}

type TimePiece = {
  start: number
  end: number
  legacy: boolean
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toSpend(value: unknown): number {
  return validTime(value) && value > 0 ? Math.floor(value) : 0
}

function toTimestamp(value: unknown, fallback: number = Date.now()): number {
  return validTime(value) ? Math.floor(value) : fallback
}

function segmentDuration(segment: PracticeTimeSegment): number {
  return Math.max(0, segment[1] - segment[0])
}

function validSegment(segment: unknown): segment is PracticeTimeSegment {
  return Array.isArray(segment) && segment.length === 2 && validTime(segment[0]) && validTime(segment[1])
}

function hasAccounting(value: unknown): value is PracticeTimeAccounting {
  if (!value || typeof value !== 'object') return false
  const accounting = value as PracticeTimeAccounting
  return (
    accounting.version === 1 &&
    Number.isFinite(accounting.legacySegmentCount) &&
    accounting.legacySegmentCount >= 0 &&
    Number.isFinite(accounting.legacySpend) &&
    accounting.legacySpend >= 0
  )
}

function normalizedAccounting(source: PracticeTimeSource): PracticeTimeAccounting {
  const segmentCount = Array.isArray(source.segments) ? source.segments.length : 0
  if (!hasAccounting(source.timeAccounting)) {
    return {
      version: 1,
      legacySegmentCount: segmentCount,
      legacySpend: toSpend(source.spend),
    }
  }
  return {
    version: 1,
    legacySegmentCount: Math.min(segmentCount, Math.max(0, Math.floor(source.timeAccounting.legacySegmentCount))),
    legacySpend: toSpend(source.timeAccounting.legacySpend),
  }
}

/**
 * Marks all currently persisted segments as legacy when restoring an old cache.
 * This keeps their original raw timestamps available without letting them alter
 * the already-saved `spend` total.
 */
export function initializePracticeTimeAccounting(source: PracticeTimeSource, forceLegacy: boolean = false): PracticeTimeAccounting {
  if (!forceLegacy && hasAccounting(source.timeAccounting)) {
    source.timeAccounting = normalizedAccounting(source)
    return source.timeAccounting
  }
  source.timeAccounting = {
    version: 1,
    legacySegmentCount: Array.isArray(source.segments) ? source.segments.length : 0,
    legacySpend: toSpend(source.spend),
  }
  return source.timeAccounting
}

/** Starts a fresh task whose entire duration will be measured by new segments. */
export function resetPracticeTimeAccounting(source: PracticeTimeSource): PracticeTimeAccounting {
  source.timeAccounting = { version: 1, legacySegmentCount: 0, legacySpend: 0 }
  return source.timeAccounting
}

/** Adds a new active segment. Callers decide when a restored task may resume. */
export function startPracticeTimeSegment(source: PracticeTimeSource, now: number = Date.now()): PracticeTimeSegment {
  initializePracticeTimeAccounting(source)
  if (!Array.isArray(source.segments)) source.segments = []
  const timestamp = toTimestamp(now)
  const segment: PracticeTimeSegment = [timestamp, timestamp]
  source.segments.push(segment)
  return segment
}

/** Returns the effective elapsed time: preserved legacy spend plus new segment durations. */
export function getPracticeTimeSpend(source: PracticeTimeSource): number {
  const accounting = normalizedAccounting(source)
  const segments = Array.isArray(source.segments) ? source.segments : []
  const newSpend = segments
    .slice(accounting.legacySegmentCount)
    .filter(validSegment)
    .reduce((total, segment) => total + segmentDuration(segment), 0)
  return accounting.legacySpend + newSpend
}

/**
 * Extends only the current post-upgrade segment and derives `spend` from the
 * same elapsed source. A delayed timer therefore records its true valid span,
 * rather than assuming every callback represents exactly one second.
 */
export function syncPracticeTime(source: PracticeTimeSource, now: number = Date.now()): number {
  const accounting = initializePracticeTimeAccounting(source)
  if (!Array.isArray(source.segments) || source.segments.length <= accounting.legacySegmentCount) return 0

  const segment = source.segments[source.segments.length - 1]
  if (!validSegment(segment)) return 0
  const previousEnd = Math.max(segment[0], segment[1])
  const nextEnd = Math.max(previousEnd, toTimestamp(now, previousEnd))
  segment[1] = nextEnd

  const previousSpend = toSpend(source.spend)
  const nextSpend = getPracticeTimeSpend(source)
  source.spend = nextSpend
  return Math.max(0, nextSpend - previousSpend)
}

/** Caps a late timer at the same inactivity deadline used to pause it. */
export function getPracticeTimerCutoff(now: number, lastActivityAt: number, idleMs: number): number {
  const current = toTimestamp(now)
  const activity = toTimestamp(lastActivityAt, current)
  const idle = toSpend(idleMs)
  return Math.min(current, activity + idle)
}

/**
 * Returns whether elapsed practice time crossed a persistence boundary.
 * Timer syncs can carry any millisecond value, so exact modulo checks would
 * miss a boundary after a delayed callback. A reset to zero must not save.
 */
export function crossedPracticeTimeSaveInterval(previous: number, current: number, interval: number = 30_000): boolean {
  const safeInterval = toSpend(interval)
  if (!safeInterval) return false
  const prev = toSpend(previous)
  const curr = toSpend(current)
  return curr > 0 && Math.floor(curr / safeInterval) > Math.floor(prev / safeInterval)
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function nextLocalMidnight(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

function splitByLocalDay(segment: PracticeTimeSegment, legacy: boolean): TimePiece[] {
  const start = Math.floor(segment[0])
  const end = Math.floor(segment[1])
  if (end <= start) return []

  const pieces: TimePiece[] = []
  let cursor = start
  while (cursor < end) {
    const midnight = nextLocalMidnight(cursor)
    const pieceEnd = Math.min(end, midnight > cursor ? midnight : end)
    pieces.push({ start: cursor, end: pieceEnd, legacy })
    cursor = pieceEnd
  }
  return pieces
}

function allocateByDuration(pieces: TimePiece[], targetSpend: number): number[] {
  const target = toSpend(targetSpend)
  if (!target || !pieces.length) return pieces.map(() => 0)
  const durations = pieces.map(piece => piece.end - piece.start)
  const durationTotal = durations.reduce((total, duration) => total + duration, 0)
  if (!durationTotal) return pieces.map(() => 0)

  const allocations = durations.map(duration => Math.floor(target * duration / durationTotal))
  let remainder = target - allocations.reduce((total, value) => total + value, 0)
  const order = durations
    .map((duration, index) => ({ index, fraction: (target * duration) % durationTotal }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (let index = 0; remainder > 0; index = (index + 1) % order.length) {
    allocations[order[index].index]++
    remainder--
  }
  return allocations
}

/**
 * Converts an unfinished or completed practice state into local-calendar rows.
 * The row sum always equals saved `spend`: old raw segments are weighted to
 * their legacy total, while post-upgrade segments receive the remaining total.
 */
export function getPracticeTimeDays(source: PracticeTimeSource | null | undefined): PracticeTimeDay[] {
  if (!source) return []
  const totalSpend = toSpend(source.spend)
  if (!totalSpend) return []

  const accounting = normalizedAccounting(source)
  const segments = Array.isArray(source.segments) ? source.segments : []
  const pieces = segments.flatMap((segment, index) =>
    validSegment(segment) ? splitByLocalDay(segment, index < accounting.legacySegmentCount) : []
  )
  if (!pieces.length) {
    const startDate = toTimestamp(source.startDate)
    return [{ dateKey: localDateKey(startDate), startDate, spend: totalSpend, segments: [] }]
  }

  const legacyPieces = pieces.filter(piece => piece.legacy)
  const newPieces = pieces.filter(piece => !piece.legacy)
  let legacyTarget = Math.min(totalSpend, accounting.legacySpend)
  let newTarget = totalSpend - legacyTarget
  if (!newPieces.length && legacyPieces.length) {
    legacyTarget = totalSpend
    newTarget = 0
  }

  const allocations = new Map<TimePiece, number>()
  const legacyAllocations = allocateByDuration(legacyPieces, legacyTarget)
  const newAllocations = allocateByDuration(newPieces, newTarget)
  legacyPieces.forEach((piece, index) => allocations.set(piece, legacyAllocations[index]))
  newPieces.forEach((piece, index) => allocations.set(piece, newAllocations[index]))

  const byDate = new Map<string, PracticeTimeDay>()
  // Old caches can have spend without segments. Keep that historical amount on
  // its original start date before distributing post-upgrade segments.
  if (!legacyPieces.length && legacyTarget) {
    const startDate = toTimestamp(source.startDate)
    byDate.set(localDateKey(startDate), {
      dateKey: localDateKey(startDate),
      startDate,
      spend: legacyTarget,
      segments: [],
    })
  }
  for (const piece of pieces) {
    const spend = allocations.get(piece) ?? 0
    if (!spend) continue
    const dateKey = localDateKey(piece.start)
    const day = byDate.get(dateKey) ?? { dateKey, startDate: piece.start, spend: 0, segments: [] }
    day.startDate = Math.min(day.startDate, piece.start)
    day.spend += spend
    day.segments.push([piece.start, piece.end])
    byDate.set(dateKey, day)
  }
  return Array.from(byDate.values()).sort((left, right) => left.startDate - right.startDate)
}
