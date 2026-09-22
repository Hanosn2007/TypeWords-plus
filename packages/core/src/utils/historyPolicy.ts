import { normalizeSyncRows, rowsSignatureAsync, type SafeRow } from './syncPolicy.ts'
export const HISTORY_TIME_ZONE = 'Asia/Shanghai'
let clock = { wall: Date.now(), tick: performance.now() }
let serverObserved = false
export function observeServerClock(value: string | null) {
  const wall = Date.parse(value || '')
  if (Number.isFinite(wall)) { clock = { wall, tick: performance.now() }; serverObserved = true }
}
export function assertHistoryClock(previousDay?: string) {
  if (Math.abs(Date.now() - (clock.wall + performance.now() - clock.tick)) > 5 * 60000) throw Error('本机时钟异常，暂停历史淘汰；当前学习进度仍保存在本机。请校准时间。')
  if (!serverObserved && previousDay && Date.now() - Date.parse(previousDay + 'T00:00:00+08:00') > 366 * 86400000) throw Error('本机日期距离上次历史超过一年，请联网核对时间后再整理历史；当前进度仍保存在本机。')
}
export function historyDate(now: Date): string { return new Intl.DateTimeFormat('en-CA', { timeZone: HISTORY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) }
export function retentionDays(value: number): number { if (!Number.isInteger(value) || value < 1 || value > 30) throw Error('本机保留日期数应为1–30。'); return value }
export function retainDates<T extends { day: string; deletedAt?: string; legacy?: boolean }>(items: T[], count: number): T[] {
  const days = [...new Set(items.filter(p => !p.deletedAt && !p.legacy).map(p => p.day))].sort().reverse().slice(0, count)
  return items.filter(p => p.legacy || p.deletedAt || days.includes(p.day))
}
export async function historyFingerprint(rows: SafeRow[], files: { id: string; file: Blob }[] = []): Promise<string> {
  const clean = normalizeSyncRows(rows)
  for (const row of clean) row.data_version = 1 // Encoding-version changes alone are not a learning date.
  const tasks = clean.find(r => r.type === 'practice_word')?.data
  if (tasks?.entries) for (const entry of Object.values(tasks.entries) as any[]) delete entry.updatedAt
  const attachments = await Promise.all([...files].sort((a,b) => a.id.localeCompare(b.id)).map(async f => {
    const hash = await crypto.subtle.digest('SHA-256', await f.file.arrayBuffer())
    return [f.id, [...new Uint8Array(hash)]]
  }))
  const bytes = new TextEncoder().encode(await rowsSignatureAsync(clean) + JSON.stringify(attachments))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}
