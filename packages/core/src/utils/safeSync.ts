import { get, set, update } from 'idb-keyval'
import { CloudSync, CloudSyncError, CLOUD_TOKEN_KEY } from './cloudSync'
import { decideSyncSignatures, hasLearningData, normalizeSyncRows, rowsSignatureAsync, type SafeRow, type SafeSnapshot, type SyncBaseline } from './syncPolicy'

type Hooks = { read: () => Promise<SafeRow[]>; apply: (rows: SafeRow[], expected: string) => Promise<void> }
type State = { baseline?: SyncBaseline; pending?: { expectedRevision: number; requestId: string; rows: SafeRow[]; reason?: string } }
export type RecoveryPoint = { id: string; createdAt: string; account: number; reason: string; local: SafeRow[]; remote?: SafeSnapshot }
export type SyncPreview = { local: SafeRow[]; remote: SafeSnapshot; account: number; signature: string }
const OWNER = 'typewords-sync-owner-v2'
const RECOVERY = 'typewords-sync-recovery-v2'
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
export function closeProtectionMessage(): string {
  if (!tabWritable) return ''
  if (localSaveFailed) return '本机保存失败，请先导出数据，再关闭页面。'
  if (pendingLocalWrites) return '正在保存到本机，请稍等后再关闭页面。'
  if (CloudSync.check() && ['pending', 'syncing', 'error', 'conflict'].includes(CloudSync.getStatus().status)) {
    return '已保存到本机，云端同步尚未完成。请稍等；若有冲突或网络错误，请到同步页处理。'
  }
  return ''
}
export function serializeSyncLocalWrite<T>(work: () => Promise<T>): Promise<T> {
  pendingLocalWrites++
  const result = localWrites.catch(() => {}).then(() => {
    if (!tabWritable) throw new Error('另一个标签页正在保存数据，请关闭它后刷新。')
    return work()
  })
  localWrites = result.then(() => {}, () => { localSaveFailed = true }).finally(() => {
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

export async function saveRecoveryPoint(reason: string, local: SafeRow[], remote?: SafeSnapshot, id = account) {
  const point: RecoveryPoint = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), account: id, reason, local: normalizeSyncRows(local), remote }
  await update<RecoveryPoint[]>(RECOVERY, old => [...(old || []), point].slice(-3))
  return point.id
}
export async function localRecoveryPoints(): Promise<RecoveryPoint[]> { return await get(RECOVERY) || [] }

export async function prepareAuthentication() {
  suspendSafeSync()
  await running
  await saveRecoveryPoint('登录前', await hooks.read(), undefined, (await get(OWNER)) || 0)
}

function pageInactive() {
  return typeof document !== 'undefined' && (document.visibilityState === 'hidden' || !document.hasFocus())
}

export function scheduleSafeSync() {
  if (typeof window === 'undefined' || suspended || !tabWritable || !CloudSync.check()) return
  if (!pageInactive()) {
    CloudSync.setStatus('pending', '已保存到本机，离开窗口后同步')
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
    if (suspended || !tabWritable || !CloudSync.check()) return false
    if (automatic && !pageInactive()) return false
    await localWrites
    if (automatic && !pageInactive()) return false
    try {
      const id = await identity(); assertIdentity(id)
      if ((await get(OWNER)) && (await get(OWNER)) !== id) {
        CloudSync.setStatus('conflict', '本机属于另一个账号。请在同步页选择保留哪份数据。'); return false
      }
      CloudSync.setStatus('syncing', '正在同步')
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
        await saveRecoveryPoint('下载云端前', local, remote, id)
        assertIdentity(id)
        await hooks.apply(remote.rows, signature)
        await acknowledge(id, remote.revision, await hooks.read())
      } else {
        CloudSync.setStatus('conflict', decision === 'pull' ? '云端有更新。练习未被打断，请到同步页查看。' : '本机和云端都有不同进度，双方已保留，请到同步页处理。')
        return false
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
    const id = await identity(); assertIdentity(id)
    const local = await hooks.read(); const remote = await CloudSync.snapshot(); assertIdentity(id)
    return { local, remote, account: id, signature: await rowsSignatureAsync(local) }
  })
}

export function replaceLocalSnapshot(rows: SafeRow[], reason: string): Promise<void> {
  return exclusive(async () => {
    const local = await hooks.read()
    await saveRecoveryPoint(reason, local, undefined, (await get(OWNER)) || 0)
    await hooks.apply(rows, await rowsSignatureAsync(local))
    scheduleSafeSync()
  })
}

export function resolveSync(preview: SyncPreview, choice: 'local' | 'remote', restored?: SafeRow[]): Promise<void> {
  return exclusive(async () => {
    const id = await identity(); assertIdentity(id)
    if (id !== preview.account) throw new Error('账号已改变，请重新查看。')
    const remote = await CloudSync.snapshot()
    if (remote.revision !== preview.remote.revision || await rowsSignatureAsync(await hooks.read()) !== preview.signature) throw new Error('查看后数据又发生变化，请重新比较；本次未覆盖。')
    await saveRecoveryPoint(restored ? '恢复前' : '冲突处理前', preview.local, remote, id)
    assertIdentity(id)
    if (choice === 'remote' && !restored) {
      await hooks.apply(remote.rows, preview.signature)
      await acknowledge(id, remote.revision, await hooks.read())
    } else {
      const desired = restored ? normalizeSyncRows(restored) : preview.local
      // A recovery is a new revision, not database rollback. The server backs up the current cloud snapshot.
      state!.pending = undefined
      await upload(id, desired, remote.revision, restored ? 'restore' : 'resolve')
      if (restored) { await hooks.apply(desired, preview.signature); await acknowledge(id, state!.baseline!.revision, await hooks.read()) }
    }
    suspended = false
    CloudSync.setStatus('success', '已同步；覆盖前的副本保留在恢复记录中')
  })
}
