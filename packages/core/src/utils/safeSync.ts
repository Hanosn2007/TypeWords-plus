import { get, set } from 'idb-keyval'
import { CloudSync, CloudSyncError, CLOUD_TOKEN_KEY } from './cloudSync'
import { decideSyncSignatures, hasLearningData, normalizeSyncRows, rowsSignatureAsync, type SafeRow, type SafeSnapshot, type SyncBaseline } from './syncPolicy'

type Hooks = { read: () => Promise<SafeRow[]>; apply: (rows: SafeRow[], expected: string, options?: { files?: import('./dataArchive').Attachment[]; replacement?: boolean; beforeCommit?: () => void }) => Promise<void>; upgrade?: (rows: SafeRow[]) => SafeRow[]; flush?: () => Promise<void>; checkpoint?: () => Promise<void>; beforeUpload?: (rows: SafeRow[]) => void }
export const LOCAL_REPLACEMENT_KEY = 'typewords-local-replacement-pending'
const saveBarriers = new Set<() => Promise<unknown>>()
export function registerSaveBarrier(barrier: () => Promise<unknown>) { saveBarriers.add(barrier) }
export function localSaveStatus() { return { pending: pendingLocalWrites, failed: localSaveFailed } }
export async function flushActiveEditors() {
  const waits: Promise<unknown>[] = []
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('typewords-save-before-update', { detail: waits }))
  await Promise.all(waits)
  await Promise.all([...saveBarriers].map(fn => fn()))
  await waitForLocalSave()
}
async function checkpoint() {
  try { await hooks.checkpoint?.() } catch (error) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('typewords-history-error', { detail: (error as Error).message })) }
}
type State = { baseline?: SyncBaseline; pending?: { expectedRevision: number; requestId: string; rows: SafeRow[]; reason?: string } }
export type SyncPreview = { local: SafeRow[]; remote: SafeSnapshot; account: number; signature: string }
const OWNER = 'typewords-sync-owner-v2'
let hooks: Hooks
let automaticQueued = false
let running: Promise<any> = Promise.resolve()
let initialized = false
let suspended = false
let cachedToken = ''
let account = 0
let state: State | undefined
let tabWritable = true
let writerClaim: Promise<boolean> | undefined
let localWrites: Promise<any> = Promise.resolve()
let pendingLocalWrites = 0
let localSaveFailed = false
let savedReload = false
const failedLocalKeys = new Set<string>()
export async function waitForLocalSave() {
  await localWrites
  if (localSaveFailed) throw new Error('本机保存失败，请先导出数据，暂不刷新。')
}
/** Explicit update flow has flushed every active editor before calling this. */
export async function allowSavedReload() { await waitForLocalSave(); savedReload = true }
export function closeProtectionMessage(): string {
  if (!tabWritable) return ''
  if (localSaveFailed) return '本机保存失败，请先导出数据，再关闭页面。'
  if (pendingLocalWrites) return '正在保存到本机，请稍等后再关闭页面。'
  if (savedReload) return ''
  if (CloudSync.check() && ['pending', 'syncing', 'error', 'conflict'].includes(CloudSync.getStatus().status)) {
    return '已保存到本机，云端同步尚未完成。请稍等；若有冲突或网络错误，请到同步页处理。'
  }
  return ''
}
export function serializeSyncLocalWrite<T>(work: () => Promise<T>, key = 'unknown', dirtyOnFailure = true): Promise<T> {
  pendingLocalWrites++
  const result = localWrites.catch(() => {}).then(() => {
    if (!tabWritable) throw new Error('另一个标签页正在保存数据，请关闭它后刷新。')
    return work()
  })
  localWrites = result.then(() => { failedLocalKeys.delete(key) }, () => { if (dirtyOnFailure) failedLocalKeys.add(key) }).finally(() => {
    localSaveFailed = failedLocalKeys.size > 0
    pendingLocalWrites--
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('typewords-sync-status'))
  })
  return result
}

export function configureSafeSync(value: Hooks) {
  hooks = value
  if (typeof window !== 'undefined' && !initialized) {
    initialized = true
    window.addEventListener('beforeunload', event => {
      if (!closeProtectionMessage()) return
      event.preventDefault()
      event.returnValue = ''
      window.dispatchEvent(new Event('typewords-close-pending'))
      // If the user chooses to stay, finish the existing save/sync normally.
      // The browser owns the confirmation text; no snapshot work in this handler.
      if (!localSaveFailed) void syncSafely(false)
    })
    window.addEventListener('online', () => scheduleSafeSync())
    window.addEventListener('blur', () => scheduleSafeSync())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') scheduleSafeSync()
    })
    window.addEventListener('storage', e => {
      if (e.key === CLOUD_TOKEN_KEY) { suspended = true; CloudSync.setStatus('conflict', '账号已在另一页面改变，请刷新后继续。') }
    })
  }
}

// One writable tab per origin avoids two in-memory stores overwriting shared IDB.
export async function claimSyncWriter(): Promise<boolean> {
  if (writerClaim) return writerClaim
  if (typeof navigator === 'undefined') return true
  if (!navigator.locks) { tabWritable = false; return false }
  writerClaim = new Promise(resolve => {
    void navigator.locks.request('typewords-local-writer-v2', { ifAvailable: true }, async lock => {
      tabWritable = !!lock
      resolve(tabWritable)
      if (lock) await new Promise<void>(() => {})
    })
  })
  return writerClaim
}

export function suspendSafeSync() { suspended = true }
export function resumeSafeSync() { suspended = false; scheduleSafeSync() }
export function safeSyncWritable() { return tabWritable }

async function identity() {
  const token = localStorage.getItem(CLOUD_TOKEN_KEY) || ''
  if (!token) throw new Error('请先登录；本机数据仍保留。')
  if (token !== cachedToken || !account) {
    const user = await CloudSync.me()
    if (localStorage.getItem(CLOUD_TOKEN_KEY) !== token) throw new Error('账号在请求期间改变，请刷新。')
    account = user.id; cachedToken = token
    state = await get<State>(`typewords-sync-state-v2:${account}`) || {}
  }
  return account
}
function assertIdentity(id: number) {
  if (account !== id || localStorage.getItem(CLOUD_TOKEN_KEY) !== cachedToken) throw new Error('账号已改变，已停止同步。')
  if (!tabWritable) throw new Error('另一个标签页正在保存数据，请关闭它后刷新。')
}
async function saveState(id: number) { assertIdentity(id); await set(`typewords-sync-state-v2:${id}`, state) }
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = running.catch(() => {}).then(work)
  running = result.catch(() => {})
  return result
}

export async function prepareAuthentication() {
  suspendSafeSync()
  await running
  await hooks.flush?.()
  await checkpoint()
}

function pageInactive() {
  return typeof document !== 'undefined' && (document.visibilityState === 'hidden' || !document.hasFocus())
}

export function scheduleSafeSync() {
  if (typeof window === 'undefined' || suspended || !tabWritable ) return
  if (!pageInactive()) {
    if (CloudSync.check()) CloudSync.setStatus('pending', '已保存到本机，离开窗口后同步')
    return
  }
  // Coalesce blur/visibility/save events; recheck focus when the queue runs.
  if (automaticQueued) return
  automaticQueued = true
  void syncSafely(false, true).finally(() => { automaticQueued = false })
}

async function acknowledge(id: number, revision: number, rows: SafeRow[], signature?: string) {
  state = { baseline: { revision, signature: signature ?? await rowsSignatureAsync(rows) } }
  await saveState(id)
  await set(OWNER, id)
}

async function upload(id: number, rows: SafeRow[], revision: number, reason?: string) {
  hooks.beforeUpload?.(rows)
  if (!state!.pending) {
    state!.pending = { expectedRevision: revision, requestId: crypto.randomUUID(), rows, ...(reason ? { reason } : {}) }
    await saveState(id) // Persist request identity before networking, including uncertain acknowledgements.
  }
  const sent = state!.pending!
  assertIdentity(id)
  const result = await CloudSync.putSnapshot(sent)
  assertIdentity(id)
  await acknowledge(id, result.revision, sent.rows)
  if (await rowsSignatureAsync(await hooks.read()) !== state!.baseline!.signature) scheduleSafeSync()
}

export function syncSafely(allowRemote = false, automatic = false): Promise<boolean> {
  return exclusive(async () => {
    if (suspended || !tabWritable) return false
    if (automatic && !pageInactive()) return false
    try {
      await hooks.flush?.()
      await localWrites
      await checkpoint()
      if (!CloudSync.check()) return true
      if (automatic && !pageInactive()) return false
      const id = await identity(); assertIdentity(id)
      if ((await get(OWNER)) && (await get(OWNER)) !== id) {
        CloudSync.setStatus('conflict', '本机属于另一个账号。请在同步页选择保留哪份数据。'); return false
      }
      CloudSync.setStatus('syncing', '正在同步')
      if (await get(LOCAL_REPLACEMENT_KEY)) {
        CloudSync.setStatus('conflict', '本机已恢复或导入，请比较云端后确认同步。'); return false
      }
      if (state!.pending) await upload(id, state!.pending.rows, state!.pending.expectedRevision)
      const local = await hooks.read()
      const signature = await rowsSignatureAsync(local)
      const remote = await CloudSync.snapshot(); assertIdentity(id)
      if (await rowsSignatureAsync(await hooks.read()) !== signature) { scheduleSafeSync(); return false }
      const decision = decideSyncSignatures(signature, await rowsSignatureAsync(remote.rows), remote.revision, remote.rows.length === 0, hasLearningData(local), state!.baseline)
      if (decision === 'same') await acknowledge(id, remote.revision, local, signature)
      else if (decision === 'push') {
        await upload(id, local, remote.revision)
      } else if (decision === 'pull' && allowRemote) {
        assertIdentity(id)
        await hooks.apply(remote.rows, signature, { beforeCommit: () => assertIdentity(id) })
        await acknowledge(id, remote.revision, await hooks.read())
      } else {
        CloudSync.setStatus('conflict', decision === 'pull' ? '云端有更新。练习未被打断，请到同步页查看。' : '本机和云端都有不同进度，双方已保留，请到同步页处理。')
        return false
      }
      await checkpoint()
      if (await rowsSignatureAsync(await hooks.read()) !== state!.baseline?.signature) {
        CloudSync.setStatus('pending', '本机还有更新，离开窗口后继续同步'); return false
      }
      CloudSync.setStatus('success', '已同步到云端')
      return true
    } catch (error) {
      const message = (error as Error).message
      if (error instanceof CloudSyncError && error.statusCode === 409) {
        CloudSync.setStatus('conflict', '另一台设备更新了云端，本机数据已保留。请到同步页处理。')
      } else {
        CloudSync.setStatus('error', '本机数据已保留：' + message)
        // Persisted request IDs survive failures. Retry on the next background,
        // online or manual event, never on a periodic timer while typing.
      }
      return false
    }
  })
}

export function previewSync(): Promise<SyncPreview> {
  return exclusive(async () => {
    await hooks.flush?.()
    const id = await identity(); assertIdentity(id)
    const local = await hooks.read(); const remote = await CloudSync.snapshot(); assertIdentity(id)
    return { local, remote, account: id, signature: await rowsSignatureAsync(local) }
  })
}

export async function previewLocalReplacement() {
  await hooks.flush?.()
  return { signature: await rowsSignatureAsync(await hooks.read()), owner: (await get(OWNER)) || 0 }
}

export function replaceLocalSnapshot(rows: SafeRow[], reason: string, options: { files?: import('./dataArchive').Attachment[]; expected?: string; owner?: number } = {}): Promise<void> {
  return exclusive(async () => {
    const wasSuspended = suspended
    suspended = true
    try {
      await hooks.flush?.()
      const local = await hooks.read(), owner = (await get(OWNER)) || 0
      const signature = await rowsSignatureAsync(local)
      if ((options.expected && options.expected !== signature) || (options.owner !== undefined && owner !== options.owner)) throw Error('预览后本机数据或账号发生变化，请重新比较。')
      await hooks.apply(rows, signature, { files: options.files, replacement: true })
      await checkpoint()
      if (CloudSync.check()) CloudSync.setStatus('conflict', '本机已' + reason + '；请比较后同步云端。')
    } finally { suspended = wasSuspended }
  })
}

export function resolveSync(preview: SyncPreview, choice: 'local' | 'remote', restored?: SafeRow[]): Promise<void> {
  return exclusive(async () => {
    await hooks.flush?.()
    const id = await identity(); assertIdentity(id)
    if (id !== preview.account) throw new Error('账号已改变，请重新查看。')
    const remote = await CloudSync.snapshot()
    if (remote.revision !== preview.remote.revision || await rowsSignatureAsync(await hooks.read()) !== preview.signature) throw new Error('查看后数据又发生变化，请重新比较；本次未覆盖。')
    // Reconcile an uncertain old request without replaying its old body over a restoration.
    if (state!.pending) await CloudSync.receipt(state!.pending.requestId)
    assertIdentity(id)
    if (restored) {
      const desired = hooks.upgrade?.(normalizeSyncRows(restored)) ?? normalizeSyncRows(restored)
      await hooks.apply(desired, preview.signature, { replacement: true })
      await checkpoint()
      CloudSync.setStatus('conflict', '已恢复到本机，请重新比较后同步云端。')
      return
    }
    if (choice === 'remote') {
      await hooks.apply(remote.rows, preview.signature, { beforeCommit: () => assertIdentity(id) })
      await acknowledge(id, remote.revision, await hooks.read())
    } else {
      state!.pending = undefined
      await upload(id, preview.local, remote.revision, 'resolve')
    }
    await set(LOCAL_REPLACEMENT_KEY, false)
    await checkpoint()
    suspended = false
    const changed = await rowsSignatureAsync(await hooks.read()) !== state!.baseline?.signature
    CloudSync.setStatus(changed ? 'pending' : 'success', changed ? '已确认版本，本机新变更等待下次同步' : '本机与云端已同步')
  })
}
