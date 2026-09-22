import JSZip from 'jszip'
import { decodeArchive, encodeArchive, validateAttachments, type Attachment } from './dataArchive'
import type { SafeRow } from './syncPolicy'
import { getMany } from 'idb-keyval'
import { DATA_KEYS } from './dataArchive'

export async function exportStoredOriginal(): Promise<void> {
  const keys = Object.values(DATA_KEYS), values = await getMany([...keys, 'typing-word-files'])
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify({ entries: keys.map((key, i) => [key, values[i] ?? localStorage.getItem(key)]) }))
  for (const attachment of values[4] || []) {
    if (typeof attachment.id !== 'string' || /[/\\]/.test(attachment.id) || !(attachment.file instanceof Blob)) continue
    zip.file('mp3/' + attachment.id + '.mp3', await attachment.file.arrayBuffer())
  }
  downloadBlob(await zip.generateAsync({ type: 'blob' }), 'TypeWords-local-original.zip')
}

export async function readArchiveFile(file: File): Promise<{ value: any; files: Attachment[] }> {
  if (file.size > 512 * 1024 * 1024) throw Error('文件超过512MB，请先拆分或联系维护者。')
  if (file.name.toLowerCase().endsWith('.json')) return { value: JSON.parse(await file.text()), files: [] }
  if (!file.name.toLowerCase().endsWith('.zip')) throw Error('请选择完整学习数据的JSON或ZIP；词书内容请到书库导入。')
  const zip = await JSZip.loadAsync(file)
  const data = zip.file('data.json')
  if (!data) throw Error('ZIP中缺少data.json，本机数据未改动。')
  const value = JSON.parse(await data.async('string'))
  const files: Attachment[] = []
  let total = 0
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('mp3/')) continue
    if (!/^mp3\/[^/\\]+\.mp3$/.test(name)) throw Error('附件路径不合法。')
    const blob = await entry.async('blob'); total += blob.size
    if (total > 512 * 1024 * 1024) throw Error('解压附件超过512MB。')
    files.push({ id: name.slice(4, -4), file: blob })
  }
  return { value, files }
}

export async function createArchiveZip(rows: SafeRow[], files: Attachment[]): Promise<Blob> {
  validateAttachments(rows, files)
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify(encodeArchive(rows)))
  for (const file of files) {
    if (!file.id || /[/\\]/.test(file.id)) throw Error('附件标识无效。')
    zip.file('mp3/' + file.id + '.mp3', await file.file.arrayBuffer())
  }
  return zip.generateAsync({ type: 'blob' })
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Only an explicit user action can read the old service. No background or write API. */
export async function readLegacySupabase(): Promise<SafeRow[]> {
  const raw = localStorage.getItem('supabase_config')
  if (!raw) throw Error('本浏览器没有旧Supabase配置，可直接导入旧导出文件。')
  const config = JSON.parse(raw), url = new URL(config.url)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw Error('旧服务地址必须使用HTTPS或本机地址。')
  const response = await fetch(url.origin + '/rest/v1/typewords_data?select=type,data,data_version', { method: 'GET', headers: { apikey: config.key, Authorization: 'Bearer ' + config.key }, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('读取旧服务失败：' + response.status)
  const rows = await response.json()
  if (!Array.isArray(rows)) throw Error('旧服务没有返回数据列表。')
  // The retired service allowed absent practice rows; only this explicit migration supplies empty caches.
  for (const type of ['practice_word', 'practice_article']) if (!rows.some(r => r.type === type)) rows.push({ type, data: null, data_version: 1 })
  return decodeArchive({ rows })
}
