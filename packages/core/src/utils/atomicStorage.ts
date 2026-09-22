import { createStore, type UseStore } from 'idb-keyval'

let store: UseStore | undefined
/** Abort even synchronous put/clone failures; resolve only after transaction completion. */
export function atomicSetMany(entries: [IDBValidKey, unknown][], useStore?: UseStore): Promise<void> {
  const use = useStore ?? (store ||= createStore('keyval-store', 'keyval'))
  return use('readwrite', objectStore => new Promise<void>((resolve, reject) => {
    const tx = objectStore.transaction
    let failure: unknown
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(failure || tx.error || new Error('本机事务已取消，原数据未修改。'))
    tx.onerror = () => { failure ||= tx.error }
    try { for (const [key, value] of entries) objectStore.put(value, key) }
    catch (error) { failure = error; tx.abort() }
  }))
}
