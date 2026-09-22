import { shallowRef } from 'vue'
import { getMany } from 'idb-keyval'
import { DATA_KEYS, DATA_VERSIONS, validateRows } from './dataArchive'
import { checkAndUpgradeSaveDict, checkAndUpgradeSaveSetting } from './index'
import { getDefaultBaseState, getDefaultSettingState } from '../stores'
import { upgradePracticeScopes } from './cache'

export const localDataError = shallowRef('')
/** Validate persisted learning before tolerant startup readers or subscriptions can write. */
export async function inspectStoredData() {
  const types = Object.keys(DATA_KEYS), values = await getMany(types.map(t => DATA_KEYS[t]))
  const rows = []
  for (let i = 0; i < types.length; i++) {
    const type = types[i], raw = values[i] ?? localStorage.getItem(DATA_KEYS[type])
    const envelope = raw == null ? null : typeof raw === 'string' ? JSON.parse(raw) : raw
    if (envelope && (!Number.isInteger(envelope.version) || envelope.version < 1 || envelope.version > DATA_VERSIONS[type] || !('val' in envelope))) throw Error('本机 ' + type + ' 格式或版本无法读取。')
    let value = envelope?.val
    if (type === 'dict') value = envelope ? await checkAndUpgradeSaveDict(envelope, true) : getDefaultBaseState()
    if (type === 'setting') value = envelope ? await checkAndUpgradeSaveSetting(envelope, true) : getDefaultSettingState()
    // Preserve old unscoped data for the existing explicit upgrade flow.
    if (type === 'practice_word') value = envelope ? value : null
    rows.push({ type, data: value ?? null, data_version: envelope?.version ?? DATA_VERSIONS[type] })
  }
  validateRows(rows)
}
