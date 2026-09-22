export type SafeRow = { type: string; data: any; data_version: number }
export type SafeSnapshot = { revision: number; rows: SafeRow[] }
export type SyncBaseline = { revision: number; signature: string }
export const SAFE_TYPES = ['dict', 'setting', 'practice_word', 'practice_article'] as const

export function stableJSON(value: any): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']'
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}'
}

export function normalizeSyncRows(rows: SafeRow[]): SafeRow[] {
  return SAFE_TYPES.map(type => {
    const row = rows.find(r => r.type === type)
    if (!row) return { type, data: null, data_version: type === 'dict' ? 4 : type === 'setting' ? 25 : 1 }
    const data = JSON.parse(JSON.stringify(row.data ?? null))
    if ((type === 'dict' || type === 'setting') && data) {
      delete data.load
      delete data._ignoreWatch
      delete data.__updateLocalData
    }
    return { type, data, data_version: row.data_version }
  })
}

export function rowsSignature(rows: SafeRow[]) { return stableJSON(normalizeSyncRows(rows)) }

// The exact same canonical representation as rowsSignature, but release the
// main thread between small batches so key/input events can be painted.
// Callers pass owned JSON snapshots, never a live reactive store.
export async function rowsSignatureAsync(rows: SafeRow[], yieldTask: () => Promise<void> = yieldToInput): Promise<string> {
  const view = SAFE_TYPES.map(type => {
    const row = rows.find(r => r.type === type)
    let data = row?.data ?? null
    if ((type === 'dict' || type === 'setting') && data && typeof data === 'object') {
      data = { ...data }; delete data.load; delete data._ignoreWatch; delete data.__updateLocalData
    }
    return { type, data, data_version: row ? row.data_version : (type === 'dict' ? 4 : type === 'setting' ? 25 : 1) }
  })
  function* tokens(value: any, key = ''): Generator<string> {
    if (value && typeof value.toJSON === 'function') value = value.toJSON(key)
    if (value === null || typeof value !== 'object') { yield JSON.stringify(value) ?? 'null'; return }
    if (Array.isArray(value)) {
      yield '['
      for (let i = 0; i < value.length; i++) { if (i) yield ','; yield* tokens(value[i], String(i)) }
      yield ']'; return
    }
    yield '{'
    let first = true
    for (const k of Object.keys(value).filter(k => value[k] !== undefined && typeof value[k] !== 'function' && typeof value[k] !== 'symbol').sort()) {
      if (!first) yield ','; first = false
      yield JSON.stringify(k) + ':'; yield* tokens(value[k], k)
    }
    yield '}'
  }
  const chunks: string[] = []
  let part: string[] = [], size = 0, count = 0, deadline = performance.now() + 4
  for (const token of tokens(view)) {
    part.push(token); size += token.length
    if (size >= 32768) { chunks.push(part.join('')); part = []; size = 0 }
    if (++count % 128 === 0 && performance.now() >= deadline) {
      await yieldTask(); deadline = performance.now() + 4
    }
  }
  chunks.push(part.join(''))
  return chunks.join('')
}

async function yieldToInput() {
  const scheduler = (globalThis as any).scheduler
  if (scheduler?.yield) await scheduler.yield()
  else await new Promise<void>(resolve => setTimeout(resolve, 0))
}

export function hasLearningData(rows: SafeRow[]) {
  const dict = rows.find(r => r.type === 'dict')?.data
  if ((dict?.word?.bookList ?? []).some((b: any) => !['wordCollect', 'wordWrong', 'wordKnown'].includes(b.id) || b.words?.length || b.statistics?.length)) return true
  if ((dict?.article?.bookList ?? []).some((b: any) => b.articles?.length || b.statistics?.length)) return true
  return rows.some(r => (r.type === 'practice_word' || r.type === 'practice_article') && r.data && (r.data.entries ? Object.values(r.data.entries).some((e: any) => e.data) : Object.keys(r.data).length))
}

export function decideSync(local: SafeRow[], remote: SafeSnapshot, baseline?: SyncBaseline, differentOwner = false): 'same' | 'push' | 'pull' | 'conflict' {
  if (differentOwner) return 'conflict'
  const signature = rowsSignature(local)
  return decideSyncSignatures(signature, rowsSignature(remote.rows), remote.revision, remote.rows.length === 0, hasLearningData(local), baseline)
}

export function decideSyncSignatures(signature: string, remoteSignature: string, revision: number, remoteEmpty: boolean, localHasData: boolean, baseline?: SyncBaseline): 'same' | 'push' | 'pull' | 'conflict' {
  if (signature === remoteSignature) return 'same'
  if (!baseline) {
    if (remoteEmpty) return 'push'
    if (!localHasData) return 'pull'
    return 'conflict'
  }
  const localChanged = signature !== baseline.signature
  const remoteChanged = revision !== baseline.revision
  if (!localChanged && remoteChanged) return 'pull'
  if (localChanged && !remoteChanged) return 'push'
  // Normalization/migration can change the local representation after a pull.
  // An unchanged baseline on both sides requires no write in either direction.
  if (!localChanged && !remoteChanged) return 'same'
  return 'conflict'
}

export function describeSnapshot(rows: SafeRow[]) {
  const dict = rows.find(r => r.type === 'dict')?.data
  const books = (dict?.word?.bookList ?? []).filter((b: any) => !['wordCollect', 'wordWrong', 'wordKnown'].includes(b.id))
  return {
    books: books.map((b: any) => ({ id: b.id, name: b.name, learned: b.learning?.learnedWords?.length ?? b.lastLearnIndex ?? 0 })),
    completedMinutes: Math.floor(books.reduce((sum: number, b: any) => sum + (b.statistics ?? []).reduce((n: number, s: any) => n + (s.spend || 0), 0), 0) / 60000),
    unfinished: Object.values(rows.find(r => r.type === 'practice_word')?.data?.entries ?? {}).filter((e: any) => e.data).length,
  }
}
