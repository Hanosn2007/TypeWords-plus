import { get, set, del } from 'idb-keyval'
import { atomicSetMany as setMany } from './atomicStorage.ts'
import { historyDate, historyFingerprint, retainDates, retentionDays, assertHistoryClock } from './historyPolicy.ts'
import { describeSnapshot, type SafeRow } from './syncPolicy.ts'
import { decodeArchive, requiredAttachmentIDs, type Attachment } from './dataArchive.ts'

export type HistoryPoint = { id: string; owner: number; day: string; savedAt: string; summary: ReturnType<typeof describeSnapshot>; deletedAt?: string; legacy?: boolean; label?: string }
type Index = { points: HistoryPoint[]; days: number; fingerprint?: string; lastDay?: string; migrated: string[]; errors?: { id: string; label: string; message: string }[] }
type Payload = { rows: SafeRow[]; files: Attachment[] }
const OWNER = 'typewords-sync-owner-v2'
export const HISTORY_DIRTY_KEY = 'typewords-history-dirty-at'
const indexKey = (owner: number) => `typewords-history-index:${owner}`
const payloadKey = (id: string) => `typewords-history-payload:${id}`
let read: (() => Promise<Payload>) | undefined
let serial: Promise<unknown> = Promise.resolve()
let generation = 0, handledGeneration = 0, changedAt = new Date()
export function configureLocalHistory(reader: () => Promise<Payload>) { read = reader }
export function markHistoryDirty() { generation++; changedAt = new Date() }
/** Runs only once when a save crosses midnight, before replacing yesterday's persisted data. */
export async function checkpointBeforeNewDate() {
  const pending = await get<string>(HISTORY_DIRTY_KEY)
  if (pending && historyDate(new Date(pending)) !== historyDate(new Date())) await checkpointLocalHistory()
}
export async function historyOwner(): Promise<number> { return (await get<number>(OWNER)) || 0 }
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => { const next = serial.catch(() => {}).then(fn); serial = next.catch(() => {}); return next }
async function index(owner: number): Promise<Index> { return (await get<Index>(indexKey(owner))) || { points: [], days: 3, migrated: [] } }
export async function primeLocalHistory() {
  if (!read) return
  await exclusive(async () => {
    const owner = await historyOwner(), state = await index(owner)
    if (!state.fingerprint) {
      const data = await read()
      state.fingerprint = await historyFingerprint(data.rows, data.files)
      await set(indexKey(owner), state)
    }
  })
}
export function checkpointLocalHistory(): Promise<void> {
  return exclusive(async () => {
    const pending = await get<string>(HISTORY_DIRTY_KEY)
    if (!read || (!pending && generation === handledGeneration)) return
    const capturedGeneration = generation, now = pending ? new Date(pending) : changedAt, owner = await historyOwner()
    const data = await read(), fingerprint = await historyFingerprint(data.rows, data.files), state = await index(owner)
    if (await historyOwner() !== owner) throw Error('账号归属已改变，历史保存暂停，请重新操作。')
    if (fingerprint === state.fingerprint) { handledGeneration = capturedGeneration; return }
    const day = historyDate(now)
    assertHistoryClock(state.lastDay)
    // Never let an obviously wrong clock evict useful dates.
    if (!Number.isFinite(now.getTime()) || now.getFullYear() < 2020 || (state.lastDay && day < state.lastDay)) throw Error('本机日期异常，当前进度仍已保存；请校准时间后再保存历史。')
    const point = state.points.find(p => !p.legacy && !p.deletedAt && p.day === day)
    const next: HistoryPoint = { id: point?.id || crypto.randomUUID(), owner, day, savedAt: now.toISOString(), summary: describeSnapshot(data.rows) }
    const all = [...state.points.filter(p => p.id !== next.id), next]
    const retained = retainDates(all, state.days)
    await setMany([[payloadKey(next.id), data], [indexKey(owner), { ...state, points: retained, fingerprint, lastDay: day }]])
    handledGeneration = capturedGeneration
    // Payload cleanup follows the metadata commit; a failed cleanup cannot erase a live reference.
    for (const old of all) if (!retained.some(p => p.id === old.id)) await del(payloadKey(old.id))
  })
}

export async function listLocalHistory(): Promise<{ owner: number; days: number; points: HistoryPoint[]; errors?: { id: string; label: string; message: string }[] }> {
  await migrateLegacyHistory()
  const owner = await historyOwner()
  await exclusive(async () => {
    for (const id of owner ? [owner, 0] : [0]) {
      const state = await index(id), expired = state.points.filter(p => p.deletedAt && Date.now() - Date.parse(p.deletedAt) >= 86400000)
      if (!expired.length) continue
      state.points = state.points.filter(p => !expired.some(e => e.id === p.id))
      await set(indexKey(id), state)
      for (const point of expired) await del(payloadKey(point.id))
    }
  })
  const own = await index(owner), guest = owner ? await index(0) : null
  const points = [...own.points, ...(guest?.points || [])]
  return { owner, days: own.days, errors: [...own.errors || [], ...guest?.errors || []], points: points.filter(p => !p.deletedAt || Date.now() - Date.parse(p.deletedAt) < 86400000).sort((a, b) => b.savedAt.localeCompare(a.savedAt)) }
}
export async function readUnconvertedHistory(id: string) {
  const list = await listLocalHistory()
  if (!list.errors?.some(e => e.id === id)) throw Error('无法读取其他账号的旧记录。')
  return get('typewords-legacy-raw:' + id)
}
export async function readLocalHistory(point: HistoryPoint): Promise<Payload> {
  const currentOwner = await historyOwner()
  if (point.owner !== currentOwner && point.owner !== 0) throw Error('这份记录属于另一个账号。')
  const state = await index(point.owner), found = state.points.find(p => p.id === point.id)
  if (!found || (found.deletedAt && Date.now() - Date.parse(found.deletedAt) >= 86400000)) throw Error('历史副本已删除或过期。')
  const result = await get<Payload>(payloadKey(found.id))
  if (!result) throw Error('未找到历史正文。')
  return result
}
export function deleteLocalHistory(point: HistoryPoint, undo = false) {
  return exclusive(async () => {
    await readLocalHistory(point)
    const state = await index(point.owner), stored = state.points.find(p => p.id === point.id)!
    if (undo && !stored.legacy && state.points.some(p => p.day === stored.day && !p.deletedAt && !p.legacy && p.id !== stored.id)) throw Error('当天已有更新副本，不能用撤销删除覆盖它；可先导出已删除副本。')
    if (undo) delete stored.deletedAt
    else stored.deletedAt ||= new Date().toISOString()
    if (undo && !retainDates(state.points, state.days).some(p => p.id === stored.id)) throw Error('这份副本已超出保留日期数，请先导出或增加本机保留数量。')
    const previous = state.points
    state.points = retainDates(previous, state.days)
    await set(indexKey(point.owner), state)
    for (const p of previous) if (!state.points.some(k => k.id === p.id)) await del(payloadKey(p.id))
  })
}
export function setLocalHistoryDays(days: number) {
  return exclusive(async () => {
    retentionDays(days)
    const owner = await historyOwner(), state = await index(owner)
    const kept = retainDates(state.points, days)
    await set(indexKey(owner), { ...state, days, points: kept })
    for (const point of state.points) if (!kept.some(p => p.id === point.id)) await del(payloadKey(point.id))
  })
}

/** Read old formats once. Preserve originals and stable IDs; no quota purge during migration. */
async function migrateLegacyHistory() {
  return exclusive(async () => {
    const candidates: { id: string; owner: number; at: string; label: string; read: () => Promise<any> }[] = []
    const rawRecoveries = await get<any[]>('typewords-sync-recovery-v2')
    const recoveries = Array.isArray(rawRecoveries) ? rawRecoveries.filter(p => p?.id && p.createdAt) : []
    for (const p of recoveries) candidates.push({ id: 'recovery-' + p.id, owner: p.account || 0, at: p.createdAt, label: '旧版恢复副本 · ' + p.reason, read: async () => p })
    const hashes = await get<any[]>('type-words-backup-index')
    for (const p of Array.isArray(hashes) ? hashes : []) if (p?.key && Number.isFinite(new Date(p.createdAt).getTime())) candidates.push({ id: 'hash-' + p.hash, owner: 0, at: new Date(p.createdAt).toISOString(), label: '旧版构建副本 · 账号未标识', read: () => get(p.key) })
    const original = await get<any>('typewords-before-study-scopes-v3')
    if (original) candidates.push({ id: 'before-scopes-v3', owner: 0, at: original.createdAt, label: '单元升级原件 · 账号未标识', read: async () => original })
    for (const candidate of candidates) {
      const state = await index(candidate.owner)
      if (state.migrated.includes(candidate.id)) continue
      const raw = await candidate.read()
      try {
        const rows = decodeArchive(raw)
        const point: HistoryPoint = { id: 'legacy-' + candidate.id, owner: candidate.owner, day: historyDate(new Date(candidate.at)), savedAt: candidate.at, summary: describeSnapshot(rows), legacy: true, label: candidate.label }
        state.points.push(point); state.migrated.push(candidate.id)
        const ids = new Set(requiredAttachmentIDs(rows))
        const files = (await get<Attachment[]>('typing-word-files') || []).filter(f => ids.has(f.id))
        await setMany([[payloadKey(point.id), { rows, files }], [indexKey(candidate.owner), state]])
      } catch (error) {
        state.errors ||= []
        const id = candidate.owner + ':' + candidate.id
        state.errors.push({ id, label: candidate.label, message: (error as Error).message })
        state.migrated.push(candidate.id)
        await setMany([['typewords-legacy-raw:' + id, raw], [indexKey(candidate.owner), state]])
      }
    }
  })
}
