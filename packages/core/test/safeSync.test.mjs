import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as policy from '../src/utils/syncPolicy.ts'

const source = readFileSync(new URL('../src/utils/safeSync.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const rows = n => policy.normalizeSyncRows([{ type: 'dict', data_version: 4, data: { word: { bookList: [{ id: 'mine', name: 'My book', lastLearnIndex: n }] } } }])
const clone = v => v === undefined ? v : structuredClone(v)
class CloudSyncError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode } }
function setup() {
  let local = rows(1000), remote = { revision: 0, rows: [] }, status, loseAck = false, user = 1, applyFails = false, checkpoints = 0
  const storage = new Map(), receipts = new Map(), calls = [], delays = [], tokens = new Map([['token', 'one']])
  const events = new Map()
  let focused = true, visibility = 'visible'
  const db = {
    get: async key => clone(storage.get(key)),
    set: async (key, value) => { storage.set(key, clone(value)) },
  }
  const CloudSync = {
    getStatus: () => ({ status: status?.[0] || 'idle' }),
    check: () => !!tokens.get('token'), setStatus: (...args) => { status = args },
    me: async () => ({ id: user }), snapshot: async () => clone(remote),
    receipt: async id => receipts.get(id) || null,
    putSnapshot: async payload => {
      calls.push(clone(payload))
      if (receipts.has(payload.requestId)) return receipts.get(payload.requestId)
      if (payload.expectedRevision !== remote.revision) throw new CloudSyncError('conflict', 409)
      remote = { revision: remote.revision + 1, rows: clone(payload.rows) }
      const ack = { revision: remote.revision }; receipts.set(payload.requestId, ack)
      if (loseAck) { loseAck = false; throw new Error('connection interrupted after commit') }
      return ack
    },
  }
  const deps = { 'idb-keyval': db, './cloudSync': { CloudSync, CloudSyncError, CLOUD_TOKEN_KEY: 'token' }, './syncPolicy': policy }
  function load() {
    const module = { exports: {} }
    new Function('require', 'exports', 'module', 'window', 'localStorage', 'setTimeout', 'clearTimeout', 'document', js)(
      name => deps[name], module.exports, module,
      { addEventListener: (name, fn) => events.set(name, fn), dispatchEvent: event => events.get(event.type)?.(event) }, { getItem: key => tokens.get(key) }, (_fn, delay) => { delays.push(delay); return 1 }, () => {},
      { get visibilityState() { return visibility }, hasFocus: () => focused, addEventListener: (name, fn) => events.set(name, fn) },
    )
    module.exports.configureSafeSync({ read: async () => clone(local), checkpoint: async () => { checkpoints++ }, apply: async (next, expected, options) => {
      if (applyFails) throw Error('quota exceeded')
      assert.equal(policy.rowsSignature(local), expected); local = clone(next)
      if (options?.replacement) storage.set('typewords-local-replacement-pending', true)
    } })
    return module.exports
  }
  let api = load()
  return { events, tokens, focus: value => { focused = value }, hide: () => { visibility = 'hidden' }, get api() { return api }, reopen() { api = load() }, calls, delays, storage, get local() { return local }, set local(v) { local = v }, get remote() { return remote }, set remote(v) { remote = v }, get status() { return status }, get checkpoints() { return checkpoints }, loseAck: () => { loseAck = true }, failApply: value => { applyFails = value }, switchUser: () => { user = 2; tokens.set('token', 'two') } }
}

test('lost acknowledgement retries the persisted request ID and does not discard newer local work', async () => {
  const h = setup(); h.loseAck()
  assert.equal(await h.api.syncSafely(), false)
  assert.equal(h.remote.revision, 1)
  h.local = rows(1100)
  h.reopen() // New page/process, same persisted IDB and server state.
  assert.equal(await h.api.syncSafely(), true)
  assert.equal(h.calls[0].requestId, h.calls[1].requestId)
  assert.equal(h.remote.revision, 2)
  assert.equal(policy.rowsSignature(h.remote.rows), policy.rowsSignature(rows(1100)))
  assert.equal(policy.rowsSignature(h.local), policy.rowsSignature(rows(1100)))
})
test('two-device edits stop with a conflict and neither side changes', async () => {
  const h = setup(); await h.api.syncSafely()
  h.local = rows(1100); h.remote = { revision: 2, rows: rows(1200) }
  assert.equal(await h.api.syncSafely(), false)
  assert.equal(h.status[0], 'conflict')
  assert.equal(h.calls.length, 1)
  assert.equal(policy.rowsSignature(h.local), policy.rowsSignature(rows(1100)))
})
test('remote changes never interrupt active practice; explicit resolution checkpoints the selected state', async () => {
  const h = setup(); await h.api.syncSafely()
  h.remote = { revision: 2, rows: rows(1200) }
  assert.equal(await h.api.syncSafely(false), false)
  const preview = await h.api.previewSync()
  await h.api.resolveSync(preview, 'remote')
  assert.equal(policy.rowsSignature(h.local), policy.rowsSignature(rows(1200)))
  assert.ok(h.checkpoints > 0)
  assert.equal(h.storage.has('typewords-sync-recovery-v2'), false)
})
test('local changes after preview abort the replacement', async () => {
  const h = setup(); await h.api.syncSafely()
  const preview = await h.api.previewSync(); h.local = rows(1500)
  await assert.rejects(h.api.resolveSync(preview, 'remote'), /发生变化/)
  assert.equal(policy.rowsSignature(h.local), policy.rowsSignature(rows(1500)))
})
test('failed local replacement leaves both copies intact and later saves remain usable', async () => {
  const h = setup()
  assert.equal(await h.api.syncSafely(), true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.storage.has('typewords-sync-recovery-v2'), false)
  const preview = await h.api.previewSync()
  h.failApply(true)
  await assert.rejects(h.api.replaceLocalSnapshot(rows(800), '恢复'), /quota/)
  assert.equal(h.calls.length, 1)
  assert.equal(policy.rowsSignature(h.local), policy.rowsSignature(rows(1000)))
  h.failApply(false)
  await h.api.replaceLocalSnapshot(rows(800), '恢复')
  assert.equal(policy.rowsSignature(h.local), policy.rowsSignature(rows(800)))
  assert.equal(h.remote.revision, 1)
})
test('account change never silently uploads previous account data', async () => {
  const h = setup(); await h.api.syncSafely(); h.switchUser(); h.remote = { revision: 0, rows: [] }
  assert.equal(await h.api.syncSafely(), false)
  assert.equal(h.calls.length, 1)
  assert.equal(h.status[0], 'conflict')
})

test('focused edits never schedule timed sync; blur and hidden events coalesce', async () => {
  const h = setup(); await h.api.syncSafely()
  h.local = rows(1100)
  h.api.scheduleSafeSync()
  assert.equal(h.delays.length, 0)
  assert.equal(h.calls.length, 1)
  h.focus(false); h.events.get('blur')()
  h.hide(); h.events.get('visibilitychange')()
  await h.api.previewSync() // Drain the serialized operation queue.
  assert.equal(h.calls.length, 2)
  assert.equal(policy.rowsSignature(h.remote.rows), policy.rowsSignature(rows(1100)))
})
test('quick focus return cancels queued automatic work; manual sync still works', async () => {
  const h = setup()
  h.focus(false); h.events.get('blur')(); h.focus(true)
  await h.api.previewSync()
  assert.equal(h.calls.length, 0)
  await h.api.syncSafely()
  assert.equal(h.calls.length, 1)
})
test('failed sync has no timed retry and retries the same request when backgrounded', async () => {
  const h = setup(); h.loseAck()
  await h.api.syncSafely()
  assert.equal(h.delays.length, 0)
  h.events.get('online')()
  assert.equal(h.calls.length, 1)
  h.focus(false); h.events.get('blur')()
  await h.api.previewSync()
  assert.equal(h.calls[0].requestId, h.calls[1].requestId)
  assert.equal(h.remote.revision, 1)
})

test('close guard allows synced pages and prompts for pending cloud sync', async () => {
  const h = setup(); await h.api.syncSafely()
  let prevented = false
  const event = { preventDefault: () => { prevented = true }, returnValue: undefined }
  h.events.get('beforeunload')(event)
  assert.equal(prevented, false)
  h.local = rows(1100); h.api.scheduleSafeSync()
  assert.match(h.api.closeProtectionMessage(), /已保存到本机/)
  h.events.get('beforeunload')(event)
  assert.equal(prevented, true)
  assert.equal(event.returnValue, '')
  await h.api.previewSync()
  assert.equal(h.api.closeProtectionMessage(), '')
})

test('local writes warn while pending and failures do not claim data is saved', async () => {
  const h = setup()
  let finish
  const saving = h.api.serializeSyncLocalWrite(() => new Promise(resolve => { finish = resolve }))
  assert.match(h.api.closeProtectionMessage(), /正在保存到本机/)
  await Promise.resolve(); await Promise.resolve()
  finish(); await saving
  await h.api.syncSafely()
  assert.equal(h.api.closeProtectionMessage(), '')
  await assert.rejects(h.api.serializeSyncLocalWrite(() => Promise.reject(new Error('disk full'))))
  assert.match(h.api.closeProtectionMessage(), /本机保存失败/)
  await assert.rejects(h.api.allowSavedReload(), /本机保存失败/)
})

test('explicit update can reload after local flush without a second cloud-close prompt', async () => {
  const h=setup(); h.api.scheduleSafeSync()
  assert.notEqual(h.api.closeProtectionMessage(),'')
  await h.api.allowSavedReload()
  assert.equal(h.api.closeProtectionMessage(),'')
})

test('offline restoration does not require a login or server and cannot replay an uncertain old upload', async () => {
  const h=setup(); h.loseAck(); await h.api.syncSafely()
  h.tokens.delete('token')
  const preview=await h.api.previewLocalReplacement()
  await h.api.replaceLocalSnapshot(rows(1200),'恢复',{expected:preview.signature,owner:preview.owner})
  assert.equal(h.remote.revision,1)
  h.tokens.set('token','one');h.reopen()
  assert.equal(await h.api.syncSafely(),false)
  assert.equal(h.calls.length,1)
  const comparison=await h.api.previewSync()
  await h.api.resolveSync(comparison,'local')
  assert.equal(h.remote.revision,2)
  assert.equal(policy.rowsSignature(h.remote.rows),policy.rowsSignature(rows(1200)))
  assert.equal(h.storage.get('typewords-local-replacement-pending'),false)
})

test('keyed persistence failures clear only when that data is successfully saved', async () => {
  const h=setup()
  await assert.rejects(h.api.serializeSyncLocalWrite(async()=>{throw Error('disk')},'dict'))
  await h.api.serializeSyncLocalWrite(async()=>{},'setting')
  await assert.rejects(h.api.waitForLocalSave())
  await h.api.serializeSyncLocalWrite(async()=>{},'dict');await h.api.waitForLocalSave()
  await assert.rejects(h.api.serializeSyncLocalWrite(async()=>{throw Error('import failed')},'replacement',false))
  await h.api.waitForLocalSave()
})
