<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { nanoid } from 'nanoid'
import { Toast } from '@typewords/base'
import { LibraryApi, LibraryApiError } from '@typewords/core/apis/library.ts'
import { getWordList } from '@typewords/core/apis/words.ts'
import { LIB_JS_URL } from '@typewords/core/config/env.ts'
import { loadJsLib } from '@typewords/core/utils'
import { normalizeLearningWord } from '@typewords/core/utils/bookLearning.ts'
import { emptyLibraryContent, parseLibraryImport, parseLibraryRows } from '@typewords/core/utils/libraryImport.ts'
import type { LibraryImportResult } from '@typewords/core/utils/libraryImport.ts'
import type { LibraryAdminBook, LibraryBookContent, LibraryIssue, LibraryReleaseSummary, LibraryValidation } from '@typewords/core/types/library.ts'
import type { Word } from '@typewords/core/types/types.ts'
import LibraryWordEditor from '~/components/library/LibraryWordEditor.vue'
import LibraryBookPreview from '~/components/library/LibraryBookPreview.vue'
import { useLibraryAdmin } from '~/components/library/useLibraryAdmin'

useHead({ title: '编辑共享词书 · Type Words', meta: [{ name: 'robots', content: 'noindex' }] })
const route = useRoute()
const bookId = computed(() => String(route.params.id))
const { authorized, checking, accessError, checkAccess } = useLibraryAdmin()
const book = ref<LibraryAdminBook | null>(null)
const draft = ref<LibraryBookContent>(emptyLibraryContent())
const savedSnapshot = ref('')
const snapshot = computed(() => JSON.stringify(draft.value))
const busy = ref('')
const error = ref('')
const conflict = ref(false)
const needsReload = ref(false)
const info = ref('')
type Pane = 'metadata' | 'words' | 'units' | 'history' | 'preview'
const pane = ref<Pane>('metadata')
const tabs: { id: Pane; name: string }[] = [{ id: 'metadata', name: '词书信息与导入' }, { id: 'words', name: '词条' }, { id: 'units', name: '单元' }, { id: 'history', name: '发布与历史' }]
const search = ref('')
const missingOnly = ref(false)
const wordPage = ref(1)
const editingIndex = ref<number | null>(null)
const editingWord = ref<Word | null>(null)
const editingUnitIds = ref<string[]>([])
const editorSnapshot = ref('')
const editingSnapshot = computed(() => JSON.stringify({ word: editingWord.value, units: editingUnitIds.value }))
const editorDirty = computed(() => editingWord.value !== null && editingSnapshot.value !== editorSnapshot.value)
const dirty = computed(() => !!book.value && (snapshot.value !== savedSnapshot.value || editorDirty.value))
const canMutate = computed(() => !busy.value && !conflict.value && !needsReload.value)
const validation = ref<LibraryValidation | null>(null)
const validationSnapshot = ref('')
const validationStale = computed(() => validationSnapshot.value !== snapshot.value || editorDirty.value)
const importResult = ref<LibraryImportResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const unitIndex = ref(0)
const activeUnit = computed(() => draft.value.units[unitIndex.value])
const releases = ref<LibraryReleaseSummary[]>([])
const historyError = ref('')
const publishNote = ref('')
const previewContent = ref<LibraryBookContent | null>(null)
const previewLabel = ref('')
const previewComparison = ref('')
const fillResult = ref<{ filled: number; missing: string[]; interrupted: boolean } | null>(null)
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const hasDefinition = (word: Partial<Word>) => !!word.trans?.some(item => item.cn?.trim())
const missingWords = computed(() => draft.value.words.filter(word => !hasDefinition(word)))
const filteredWords = computed(() => draft.value.words.map((word, index) => ({ word, index })).filter(({ word }) => {
  if (missingOnly.value && hasDefinition(word)) return false
  const needle = search.value.trim().toLowerCase()
  return !needle || word.word?.toLowerCase().includes(needle) || word.trans?.some(item => item.cn?.toLowerCase().includes(needle))
}))
const wordPages = computed(() => Math.max(1, Math.ceil(filteredWords.value.length / 50)))
const visibleWords = computed(() => filteredWords.value.slice((wordPage.value - 1) * 50, wordPage.value * 50))
const tagsText = ref('')
const unitMembersText = ref('')
watch(tagsText, value => { draft.value.tags = [...new Set(value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] }, { flush: 'sync' })
watch(activeUnit, unit => { unitMembersText.value = unit?.words.join('\n') ?? '' }, { flush: 'sync' })
watch(unitMembersText, value => { if (activeUnit.value) activeUnit.value.words = value.split(/\r?\n/).map(word => word.trim()).filter(Boolean) }, { flush: 'sync' })
const unitUnknownWords = computed(() => {
  const known = new Set(draft.value.words.map(word => normalizeLearningWord(word.word)))
  return activeUnit.value?.words.filter(word => !known.has(normalizeLearningWord(word))) ?? []
})
watch([search, missingOnly], () => { wordPage.value = 1 })
watch(wordPages, pages => { wordPage.value = Math.min(wordPage.value, pages) })

function editableWord(source: Partial<Word>): Word {
  return clone({ ...source, word: source.word ?? '', phonetic0: source.phonetic0 ?? '', phonetic1: source.phonetic1 ?? '', trans: source.trans ?? [], sentences: source.sentences ?? [], phrases: source.phrases ?? [], synos: source.synos ?? [], relWords: source.relWords ?? { root: '', rels: [] }, etymology: source.etymology ?? [] })
}

function resetEditor() {
  editingIndex.value = null; editingWord.value = null; editingUnitIds.value = []; editorSnapshot.value = editingSnapshot.value
}

function openWord(index: number) {
  editingIndex.value = index
  editingWord.value = editableWord(draft.value.words[index] ?? {})
  const key = normalizeLearningWord(editingWord.value.word)
  editingUnitIds.value = index < 0 ? [] : draft.value.units.filter(unit => unit.words.some(word => normalizeLearningWord(word) === key)).map(unit => unit.id)
  editorSnapshot.value = editingSnapshot.value
}

// Materialize all current input for export as well as save; even invalid edits can be rescued.
function localContent(): LibraryBookContent {
  const content = clone(draft.value)
  if (!editingWord.value || !editorDirty.value) return content
  const item = clone(editingWord.value)
  item.word = item.word.trim()
  item.synos.forEach(group => { group.ws = group.ws.map(word => word.trim()).filter(Boolean) })
  const old = editingIndex.value !== null && editingIndex.value >= 0 ? normalizeLearningWord(content.words[editingIndex.value]?.word) : ''
  if (editingIndex.value !== null && editingIndex.value >= 0) content.words[editingIndex.value] = item
  else content.words.push(item)
  for (const unit of content.units) {
    const belongs = editingUnitIds.value.includes(unit.id)
    let found = false
    unit.words = unit.words.flatMap(word => {
      if (!old || normalizeLearningWord(word) !== old) return [word]
      found = true
      return belongs ? [item.word] : []
    })
    if (belongs && !found) unit.words.push(item.word)
  }
  return content
}

function applyWord(force = false): boolean {
  if (!editingWord.value || (!editorDirty.value && !force)) return true
  const spelling = editingWord.value.word.trim()
  if (!spelling) { Toast.error('请先填写正在编辑的词条，或取消该词条编辑。'); pane.value = 'words'; return false }
  const duplicate = draft.value.words.findIndex((word, index) => index !== editingIndex.value && normalizeLearningWord(word.word) === normalizeLearningWord(spelling))
  if (duplicate >= 0) { Toast.error(`词条「${spelling}」已存在，请修改拼写后再应用。`); pane.value = 'words'; return false }
  if (force && !editorDirty.value) return true
  const nextIndex = editingIndex.value === -1 ? draft.value.words.length : editingIndex.value!
  draft.value = localContent()
  openWord(nextIndex)
  return true
}

async function selectWord(index: number) {
  if (busy.value || !applyWord()) return
  openWord(index); pane.value = 'words'
  await nextTick()
  document.getElementById('library-word-editor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function cancelWord() {
  if (busy.value || (editorDirty.value && !window.confirm('放弃此词条尚未应用的修改？词书其他草稿修改会保留。'))) return
  resetEditor()
}

function deleteWord(index: number) {
  if (busy.value || !applyWord()) return
  const word = draft.value.words[index]
  if (!word || !window.confirm(`从草稿删除「${word.word}」及其单元成员关系？发布后才会影响共享内容，个人学习历史仍会保留。`)) return
  const key = normalizeLearningWord(word.word)
  draft.value.words.splice(index, 1)
  draft.value.units.forEach(unit => { unit.words = unit.words.filter(member => normalizeLearningWord(member) !== key) })
  resetEditor()
}

function selectPane(target: Pane) {
  if (busy.value || !applyWord()) return
  if (target !== 'words') resetEditor()
  pane.value = target
}

function showError(cause: unknown) {
  if (cause instanceof LibraryApiError && cause.status === 409) {
    conflict.value = true
    error.value = '服务端草稿已被其他页面或管理员更新。本地修改已保留；请先导出备份，再重新加载并合并修改。'
  } else error.value = cause instanceof Error ? cause.message : String(cause || '操作失败，请重试。')
}

function acceptBook(value: LibraryAdminBook, preserveSelection = false) {
  const selected = preserveSelection ? normalizeLearningWord(editingWord.value?.word) : ''
  book.value = value; draft.value = clone(value.draft); tagsText.value = draft.value.tags.join(', '); savedSnapshot.value = JSON.stringify(draft.value)
  conflict.value = false; needsReload.value = false; resetEditor()
  unitIndex.value = Math.min(unitIndex.value, Math.max(0, draft.value.units.length - 1))
  if (selected) {
    const index = draft.value.words.findIndex(word => normalizeLearningWord(word.word) === selected)
    if (index >= 0) openWord(index)
  }
}

async function loadHistory() {
  if (busy.value === '正在刷新历史…') return
  const standalone = !busy.value
  if (standalone) busy.value = '正在刷新历史…'
  historyError.value = ''
  try { releases.value = await LibraryApi.releases(bookId.value) }
  catch (cause) { historyError.value = cause instanceof Error ? cause.message : '历史版本加载失败' }
  finally { if (standalone) busy.value = '' }
}

async function locateLinkedWord() {
  const linked = typeof route.query.word === 'string' ? route.query.word.trim() : ''
  if (!linked) return
  const index = draft.value.words.findIndex(word => normalizeLearningWord(word.word) === normalizeLearningWord(linked))
  pane.value = 'words'; search.value = linked; missingOnly.value = false
  if (index >= 0) openWord(index)
  else info.value = `反馈中的「${linked}」已不在当前草稿中。可到历史版本查看当时内容。`
}

async function load(confirmDiscard = true) {
  if (busy.value || !authorized.value) return
  if (confirmDiscard && dirty.value && !window.confirm('重新加载会丢弃当前未保存修改。需要保留时，请先导出本地草稿。继续重新加载？')) return
  busy.value = '正在加载词书…'; error.value = ''
  try {
    acceptBook(await LibraryApi.adminBook(bookId.value))
    validation.value = null; importResult.value = null; fillResult.value = null; info.value = ''
    await loadHistory(); await locateLinkedWord()
  } catch (cause) { showError(cause) }
  finally { busy.value = '' }
}

async function persistDraft() {
  const saved = await LibraryApi.saveDraft(bookId.value, book.value!.draftRevision, clone(draft.value))
  acceptBook(saved, true)
}

async function saveDraft() {
  if (!canMutate.value || !book.value || !applyWord()) return
  busy.value = '正在保存草稿…'; error.value = ''
  try { await persistDraft(); Toast.success('草稿已保存') }
  catch (cause) { showError(cause) }
  finally { busy.value = '' }
}

async function validateContent() {
  const content = clone(draft.value)
  const result = await LibraryApi.validate(bookId.value, content)
  validation.value = result; validationSnapshot.value = JSON.stringify(content)
  return result
}

async function validateDraft() {
  if (busy.value || !applyWord()) return
  busy.value = '正在校验本地草稿…'; error.value = ''
  try { const result = await validateContent(); if (result.valid) Toast.success('校验通过，请一并检查提示') }
  catch (cause) { showError(cause) }
  finally { busy.value = '' }
}

async function locateIssue(issue: LibraryIssue) {
  if (busy.value || !applyWord()) return
  const wordMatch = issue.path.match(/^words\[(\d+)\]/)
  const unitMatch = issue.path.match(/^units\[(\d+)\]/)
  let target = 'library-metadata'
  if (wordMatch) {
    const index = Number(wordMatch[1])
    pane.value = 'words'; search.value = ''; missingOnly.value = false; wordPage.value = Math.floor(index / 50) + 1
    if (draft.value.words[index]) openWord(index)
    target = 'library-word-editor'
  } else if (unitMatch || issue.path === 'units') {
    resetEditor(); pane.value = 'units'; unitIndex.value = unitMatch ? Number(unitMatch[1]) : 0; target = 'library-unit-editor'
  } else if (issue.path === 'words') { resetEditor(); pane.value = 'words'; target = 'library-word-list' }
  else { resetEditor(); pane.value = 'metadata'; target = `library-field-${issue.path.split('[')[0]}` }
  await nextTick()
  const element = document.getElementById(target) ?? document.getElementById('library-metadata')
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' }); element?.focus({ preventScroll: true })
}

function exportDraft() {
  const content = localContent()
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = `${(content.name || '词书草稿').replace(/[\\/:*?"<>|]/g, '_')}-草稿.json`
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value) return
  busy.value = '正在解析导入文件…'; error.value = ''
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('请选择小于20 MB的词表文件。')
    const extension = file.name.split('.').pop()?.toLowerCase()
    const name = file.name.replace(/\.[^.]+$/, '')
    let result: LibraryImportResult
    if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
      const XLSX = await loadJsLib('XLSX', LIB_JS_URL.XLSX) as typeof import('xlsx')
      const workbook = extension === 'csv' ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) throw new Error('文件没有可导入的工作表。')
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '', raw: false })
      result = parseLibraryRows(rows, name)
      if (workbook.SheetNames.length > 1) result.warnings.push(`仅导入第一个工作表「${sheetName}」，其余工作表未导入。`)
    } else if (extension === 'json' || extension === 'txt') result = parseLibraryImport(await file.text(), extension, name)
    else throw new Error('支持 JSON、Unit JSON、TXT、XLSX、XLS 和 CSV 文件。')
    if (!result.content.words.length) throw new Error('文件中没有识别到词条。请检查表头“单词 / word”或文件格式。')
    if ((draft.value.words.length || draft.value.units.length || dirty.value) && !window.confirm(`已识别 ${result.content.words.length} 个词、${result.content.units.length} 个单元。导入将替换当前草稿的元信息、词条和单元，包括未保存的修改。已发布版本不受影响。继续导入？`)) return
    draft.value = clone(result.content); tagsText.value = draft.value.tags.join(', '); resetEditor(); importResult.value = result; fillResult.value = null; unitIndex.value = 0
    search.value = ''; missingOnly.value = false; pane.value = 'metadata'; info.value = '导入已放入本地草稿，请检查并保存。'
    await validateContent()
  } catch (cause) { showError(cause) }
  finally { busy.value = ''; input.value = '' }
}

function hasPublicValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.values(value).some(hasPublicValue)
  return value != null && String(value).trim() !== ''
}

async function fillDefinitions() {
  if (busy.value || !applyWord()) return
  const targets = missingWords.value.filter(word => word.word?.trim())
  if (!targets.length) { Toast.success('当前词条已有释义'); return }
  resetEditor(); error.value = ''; fillResult.value = { filled: 0, missing: [], interrupted: false }
  busy.value = '正在查询作者词库…'
  try {
    for (let offset = 0; offset < targets.length; offset += 100) {
      busy.value = `正在补全释义：${Math.min(offset + 100, targets.length)} / ${targets.length}…`
      const batch = targets.slice(offset, offset + 100)
      const response = await getWordList(null, batch.map(word => word.word))
      if (!response.success) throw new Error(response.msg || '查询作者词库失败')
      const data = (response.data ?? {}) as unknown as { list?: Partial<Word>[]; missing?: string[] }
      const unavailable = new Set((data.missing ?? []).map(normalizeLearningWord))
      const found = new Map((data.list ?? []).filter(word => word.word && hasDefinition(word)).map(word => [normalizeLearningWord(word.word), word]))
      for (const source of batch) {
        const key = normalizeLearningWord(source.word)
        const match = found.get(key)
        if (!match || unavailable.has(key) || hasDefinition(source)) continue
        source.trans = clone(match.trans!)
        for (const field of ['phonetic0', 'phonetic1', 'sentences', 'phrases', 'synos', 'relWords', 'etymology'] as const) {
          if (!hasPublicValue(source[field]) && match[field] != null) Object.assign(source, { [field]: clone(match[field]) })
        }
        fillResult.value!.filled++
      }
    }
    Toast.success(`已补全 ${fillResult.value.filled} 个词，内容尚未保存`)
  } catch (cause) { fillResult.value!.interrupted = true; showError(cause) }
  finally {
    fillResult.value!.missing = missingWords.value.map(word => word.word || '（空词条）')
    busy.value = ''
  }
}

function addUnit() {
  if (busy.value) return
  let id = `unit-${nanoid(10)}`
  while (draft.value.units.some(unit => unit.id === id)) id = `unit-${nanoid(10)}`
  draft.value.units.push({ id, name: `单元 ${draft.value.units.length + 1}`, words: [] })
  unitIndex.value = draft.value.units.length - 1
}

function moveUnit(direction: number) {
  if (busy.value) return
  const target = unitIndex.value + direction
  if (target < 0 || target >= draft.value.units.length) return
  const [unit] = draft.value.units.splice(unitIndex.value, 1)
  draft.value.units.splice(target, 0, unit); unitIndex.value = target
}

function removeUnit() {
  if (busy.value || !activeUnit.value || !window.confirm(`删除单元「${activeUnit.value.name}」？词条仍保留在整书中。发布后选择此单元的学生会回到整书范围。`)) return
  draft.value.units.splice(unitIndex.value, 1); unitIndex.value = Math.max(0, unitIndex.value - 1)
}

function previewDraft() {
  if (busy.value || !applyWord()) return
  previewContent.value = clone(draft.value); previewLabel.value = '当前草稿（包含未保存修改）'; previewComparison.value = ''; pane.value = 'preview'
}

async function previewRelease(version: number) {
  if (busy.value || !applyWord()) return
  busy.value = `正在读取 v${version}…`; error.value = ''
  try {
    const release = await LibraryApi.historicalRelease(bookId.value, version)
    previewContent.value = clone(release.content); previewLabel.value = `历史版本 v${version} · ${new Date(release.updatedAt).toLocaleString()}`
    const before = new Map(release.content.words.map(word => [normalizeLearningWord(word.word), word]))
    const after = new Map(draft.value.words.map(word => [normalizeLearningWord(word.word), word]))
    const added = [...after.keys()].filter(key => !before.has(key)).length
    const removed = [...before.keys()].filter(key => !after.has(key)).length
    const changed = [...after.entries()].filter(([key, word]) => before.has(key) && JSON.stringify(word) !== JSON.stringify(before.get(key))).length
    previewComparison.value = `当前草稿相对 v${version}：新增 ${added} 个词，移除 ${removed} 个词，内容变化 ${changed} 个词；单元 ${release.content.units.length} → ${draft.value.units.length} 个${JSON.stringify(release.content.units) !== JSON.stringify(draft.value.units) ? '（名称、顺序或成员有变化）' : ''}。`
    pane.value = 'preview'
  } catch (cause) { showError(cause) }
  finally { busy.value = '' }
}

async function refreshAfterRelease(action: string, version: number) {
  needsReload.value = true
  try {
    acceptBook(await LibraryApi.adminBook(bookId.value))
    validation.value = null; importResult.value = null; fillResult.value = null; publishNote.value = ''
    await loadHistory()
    info.value = `${action}完成，当前发布版本为 v${version}。已重新读取最新草稿修订号。`
  } catch (cause) {
    error.value = `${action}已完成（v${version}），但刷新草稿失败。请重新加载后再继续保存或发布。${cause instanceof Error ? cause.message : ''}`
  }
}

async function publish() {
  if (!canMutate.value || !book.value || !applyWord()) return
  if (!window.confirm(`发布「${draft.value.name}」的新版本？系统会先保存并校验当前草稿，通过后向所有同学提供新内容。正在学习的任务会继续使用原版本。${publishNote.value.trim() ? `\n发布说明：${publishNote.value.trim()}` : '\n本次未填写发布说明。'}`)) return
  busy.value = '正在保存并校验…'; error.value = ''
  try {
    await persistDraft()
    const result = await validateContent()
    if (!result.valid) { Toast.error('草稿已保存，但校验未通过。请先处理下方问题。'); return }
    busy.value = '正在发布…'
    const release = await LibraryApi.publish(bookId.value, book.value.draftRevision, publishNote.value.trim())
    await refreshAfterRelease('发布', release.version)
  } catch (cause) { showError(cause) }
  finally { busy.value = '' }
}

async function rollback(version: number) {
  if (!canMutate.value || !book.value) return
  const warning = dirty.value ? '\n当前未保存的修改也会丢失；如需保留，请先导出本地草稿。' : ''
  if (!window.confirm(`将历史 v${version} 的完整内容发布为新的 v${book.value.publishedVersion + 1}，并替换当前草稿？历史版本仍会保留。${warning}\n发布说明将使用下方填写内容，留空时记录来源版本。`)) return
  busy.value = '正在回滚并发布新版本…'; error.value = ''
  try {
    const release = await LibraryApi.rollback(bookId.value, book.value.draftRevision, version, publishNote.value.trim() || `从 v${version} 回滚`)
    await refreshAfterRelease('回滚', release.version)
  } catch (cause) { showError(cause) }
  finally { busy.value = '' }
}

function leaveGuard() {
  if (busy.value) { Toast.error('当前操作尚未完成，请稍候再离开。'); return false }
  return !dirty.value || window.confirm('当前草稿有未保存修改，离开将丢失这些修改。仍要离开？')
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !busy.value) return
  event.preventDefault(); event.returnValue = ''
}
onBeforeRouteLeave(leaveGuard)
onBeforeRouteUpdate((to, from) => to.params.id === from.params.id || leaveGuard())
watch(() => route.params.id, async () => { book.value = null; resetEditor(); if (authorized.value) await load(false) })
watch(() => route.query.word, async () => { if (book.value && !busy.value && applyWord()) await locateLinkedWord() })
onMounted(async () => { window.addEventListener('beforeunload', beforeUnload); if (await checkAccess()) await load(false) })
onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <BasePage>
    <main class="library-editor">
      <header class="page-header"><div><NuxtLink to="/admin/library">← 词书管理</NuxtLink><h1>{{ book ? draft.name || '未命名词书' : '编辑共享词书' }}</h1><p v-if="book">草稿修订 {{ book.draftRevision }} · {{ book.publishedVersion ? `已发布 v${book.publishedVersion}` : '尚未发布' }} · {{ draft.words.length }} 个词 / {{ draft.units.length }} 个单元 <strong v-if="dirty" class="dirty">有未保存修改</strong><span v-else> · 已保存</span></p></div><NuxtLink v-if="authorized" :to="{ path: '/admin/library/feedback', query: { bookId } }">查看本书反馈</NuxtLink></header>
      <p v-if="checking" role="status">正在验证管理员权限…</p>
      <section v-else-if="!authorized" class="empty"><p>{{ accessError }}</p><NuxtLink to="/cloud-login">前往登录</NuxtLink><button @click="checkAccess().then(ok => ok && load(false))">重试</button></section>
      <template v-else>
        <div v-if="error" class="notice danger" role="alert"><p>{{ error }}</p><div class="actions"><button v-if="book" @click="exportDraft">导出本地草稿</button><button :disabled="!!busy" @click="load()">重新加载</button></div></div>
        <div v-if="info" class="notice" role="status">{{ info }}</div>
        <p v-if="busy" class="busy" role="status" aria-live="polite">{{ busy }}</p>
        <template v-if="book">
          <div class="toolbar"><div class="actions"><button class="primary" :disabled="!canMutate" @click="saveDraft">保存草稿</button><button :disabled="!!busy" @click="validateDraft">校验内容</button><button :disabled="!!busy" @click="previewDraft">预览当前草稿</button><button :disabled="!!busy" @click="exportDraft">导出 JSON</button></div><span class="muted">保存和发布都会包含正在编辑的词条</span></div>
          <section v-if="validation" class="validation notice" :class="{ danger: !validation.valid }" aria-label="校验结果">
            <div class="section-heading"><strong>{{ validation.valid ? '校验通过' : `${validation.errors.length} 个问题需要修复` }}<span v-if="validation.warnings.length"> · {{ validation.warnings.length }} 条提示</span></strong><small v-if="validationStale">内容已变更，请重新校验后定位问题</small></div>
            <details v-if="validation.errors.length" open><summary>错误（点击定位）</summary><ul><li v-for="(issue, index) in validation.errors" :key="index"><button class="issue-link" :disabled="!!busy || validationStale" @click="locateIssue(issue)">{{ issue.path }}：{{ issue.message }}</button></li></ul></details>
            <details v-if="validation.warnings.length"><summary>提示（点击定位）</summary><ul><li v-for="(issue, index) in validation.warnings" :key="index"><button class="issue-link" :disabled="!!busy || validationStale" @click="locateIssue(issue)">{{ issue.path }}：{{ issue.message }}</button></li></ul></details>
          </section>
          <nav class="tabs" aria-label="词书编辑分区"><button v-for="tab in tabs" :key="tab.id" :aria-current="pane === tab.id ? 'page' : undefined" :class="{ active: pane === tab.id }" :disabled="!!busy" @click="selectPane(tab.id)">{{ tab.name }}<span v-if="tab.id === 'words'"> ({{ draft.words.length }})</span><span v-if="tab.id === 'units'"> ({{ draft.units.length }})</span></button><button v-if="pane === 'preview'" class="active" aria-current="page">内容预览</button></nav>

          <fieldset :disabled="!!busy" class="editor-body">
            <section v-if="pane === 'metadata'" id="library-metadata" class="panel">
              <h2>词书信息</h2>
              <div class="metadata-grid"><label class="wide">名称 <input id="library-field-name" v-model="draft.name" /></label><label class="wide">描述 <textarea id="library-field-description" v-model="draft.description" rows="4" /></label><label>分类 <input id="library-field-category" v-model="draft.category" placeholder="如：学校词书 / 考试" /></label><label>标签（逗号分隔）<input id="library-field-tags" v-model="tagsText" placeholder="高一, 教材" /></label><label>词书语言 <select id="library-field-language" v-model="draft.language"><option value="en">英语</option><option value="ja">日语</option><option value="de">德语</option><option value="code">代码</option></select></label><label>释义语言 <select id="library-field-translateLanguage" v-model="draft.translateLanguage"><option value="zh-CN">中文</option><option value="en">英语</option><option value="ja">日语</option><option value="de">德语</option><option value="common">通用</option><option value="">未指定</option></select></label><label>排序值（越小越靠前）<input id="library-field-sortOrder" v-model.number="draft.sortOrder" type="number" step="1" min="-1000000" max="1000000" /></label><label class="check"><input v-model="draft.recommended" type="checkbox" /> 在推荐区域展示</label><label class="wide">封面地址（可选）<input id="library-field-cover" v-model="draft.cover" placeholder="https://… 或 /images/…" /></label></div>
              <section class="import-panel"><h2>导入词表</h2><p class="muted">支持 JSON、现有 Unit JSON、TXT、XLSX、XLS、CSV。TXT 每行一个词，可用 Tab 分隔释义。表格可用“单词、翻译、音标①、音标②、单元、单元ID、例句、短语、近义词、同根词、词源”表头；也支持对应英文属性名。个人笔记不会写入公共词书。</p><input ref="fileInput" type="file" accept=".json,.txt,.xlsx,.xls,.csv" class="file-input" aria-label="选择词表文件" @change="importFile" /><button @click="fileInput?.click()">选择文件导入草稿</button><p class="muted">导入会替换当前草稿，已发布版本保留。XLSX / XLS 读取第一个工作表。</p>
                <div v-if="importResult" class="notice"><strong>已导入 {{ importResult.content.words.length }} 个词 · {{ importResult.content.units.length }} 个单元</strong><p>合并重复 {{ importResult.duplicates }} 个 · 导入时缺释义 {{ importResult.missingDefinitions }} 个</p><ul v-if="importResult.warnings.length"><li v-for="(warning, index) in importResult.warnings" :key="index">{{ warning }}</li></ul></div>
              </section>
            </section>

            <section v-if="pane === 'words'" class="panel">
              <div class="section-heading"><h2>词条编辑</h2><button @click="selectWord(-1)">＋ 新增词条</button></div>
              <div class="word-tools"><label>搜索单词或释义 <input v-model="search" type="search" placeholder="输入单词或释义" /></label><label class="check"><input v-model="missingOnly" type="checkbox" /> 只看缺释义（{{ missingWords.length }}）</label><button :disabled="!missingWords.length" @click="fillDefinitions">批量补全缺释义</button></div>
              <p class="muted">补全仅在点击后查询作者词库，每批最多 100 个词。只补缺少的内容，保留已有富字段、词序和单元；补全后仍需保存和发布。</p>
              <div v-if="fillResult" class="notice"><strong>已补全 {{ fillResult.filled }} 个词{{ fillResult.interrupted ? '（查询中断，已完成内容保留）' : '' }}</strong><p>仍有 {{ fillResult.missing.length }} 个词缺少释义，可逐条编辑。</p><details v-if="fillResult.missing.length"><summary>查看尚未补全的词</summary><div class="word-chips"><button v-for="(word, index) in fillResult.missing" :key="index" @click="search = word; missingOnly = true">{{ word }}</button></div></details></div>
              <div class="word-workspace"><div id="library-word-list" class="word-list"><p class="muted">匹配 {{ filteredWords.length }} 个词，每页 50 个</p><div v-for="item in visibleWords" :key="item.index" class="word-row" :class="{ selected: editingIndex === item.index }"><button class="word-select" @click="selectWord(item.index)"><strong>{{ item.word.word || '（空词条）' }}</strong><span>{{ item.word.trans?.map(trans => `${trans.pos} ${trans.cn}`).join('；') || '缺少释义' }}</span></button><button class="danger-text" :aria-label="`删除 ${item.word.word}`" @click="deleteWord(item.index)">删除</button></div><p v-if="!visibleWords.length" class="empty-small">没有匹配的词条。</p><nav class="pagination" aria-label="词条分页"><button :disabled="wordPage === 1" @click="wordPage--">上一页</button><span>{{ wordPage }} / {{ wordPages }}</span><button :disabled="wordPage >= wordPages" @click="wordPage++">下一页</button></nav></div>
                <section id="library-word-editor" class="word-edit-form" tabindex="-1"><template v-if="editingWord"><div class="section-heading"><h3>{{ editingIndex === -1 ? '新增词条' : `编辑 ${draft.words[editingIndex!]?.word}` }}</h3><small v-if="editorDirty">未应用的编辑</small></div><LibraryWordEditor v-model="editingWord" /><details v-if="draft.units.length" class="membership"><summary>所属单元（可多选）</summary><div class="unit-checks"><label v-for="unit in draft.units" :key="unit.id" class="check"><input v-model="editingUnitIds" type="checkbox" :value="unit.id" /> {{ unit.name }}</label></div></details><div class="actions editor-actions"><button class="primary" @click="applyWord(true)">应用到本地草稿</button><button @click="cancelWord">取消词条编辑</button></div></template><p v-else class="empty-small">选择左侧词条开始编辑，或新增词条。</p></section>
              </div>
            </section>

            <section v-if="pane === 'units'" class="panel"><div class="section-heading"><h2>单元与成员</h2><button @click="addUnit">＋ 新增单元</button></div><p class="muted">单元 ID 在创建时生成，改名和排序不会改变 ID。成员按词条拼写保存；没有分配单元的词仍可在整书范围学习。</p><div class="unit-workspace"><nav class="unit-list" aria-label="单元列表"><button v-for="(unit, index) in draft.units" :key="`${unit.id}-${index}`" :class="{ selected: unitIndex === index }" @click="unitIndex = index"><span>{{ index + 1 }}. {{ unit.name || '未命名单元' }}</span><small>{{ unit.words.length }} 个词</small></button><p v-if="!draft.units.length" class="empty-small">尚未设置单元，可以直接整书学习。</p></nav><section id="library-unit-editor" tabindex="-1"><template v-if="activeUnit"><label>单元名称 <input v-model="activeUnit.name" /></label><p class="muted unit-id">稳定 ID：{{ activeUnit.id }}</p><div class="actions"><button :disabled="unitIndex === 0" @click="moveUnit(-1)">上移</button><button :disabled="unitIndex >= draft.units.length - 1" @click="moveUnit(1)">下移</button><button class="danger-text" @click="removeUnit">删除单元</button></div><label class="members-field">成员（每行一个词，行序即单元内顺序）<textarea v-model="unitMembersText" rows="18" spellcheck="false" placeholder="apple&#10;banana" /></label><p class="muted">共 {{ activeUnit.words.length }} 个成员。也可在词条编辑中勾选所属单元。</p><p v-if="unitUnknownWords.length" class="danger-text">{{ unitUnknownWords.length }} 个成员不在词书中：{{ unitUnknownWords.slice(0, 15).join('、') }}{{ unitUnknownWords.length > 15 ? '…' : '' }}</p></template><p v-else class="empty-small">选择或新增一个单元。</p></section></div></section>

            <section v-if="pane === 'history'" class="panel"><h2>发布与历史版本</h2><p class="muted">保存草稿只对管理员可见。发布会保存当前草稿、执行完整校验，并创建不可变版本；同学的进行中任务继续使用原版本。</p><label class="publish-note">本次发布 / 回滚说明（可选）<textarea v-model="publishNote" rows="3" placeholder="例如：补齐 Lesson 3 释义，修正例句" /></label><button class="primary" :disabled="!canMutate" @click="publish">保存、校验并发布新版本</button><p v-if="book.hasUnpublishedChanges || dirty" class="muted">当前有待发布修改。</p><p v-else-if="book.publishedVersion" class="muted">草稿与当前发布内容一致，仍可重新发布。</p><div class="section-heading history-heading"><h3>版本记录</h3><button @click="loadHistory">刷新历史</button></div><p v-if="historyError" role="alert" class="danger-text">{{ historyError }}</p><p v-if="!releases.length" class="empty-small">暂无发布版本。</p><article v-for="release in releases" :key="release.version" class="release-row"><div><strong>v{{ release.version }} <small v-if="release.version === book.publishedVersion">当前发布</small></strong><p>{{ release.note || '未填写发布说明' }}</p><small class="muted">{{ new Date(release.updatedAt).toLocaleString() }}</small></div><div class="actions"><button @click="previewRelease(release.version)">预览与变化概览</button><button :disabled="!canMutate" @click="rollback(release.version)">将此版回滚为新版本</button></div></article></section>

            <section v-if="pane === 'preview' && previewContent" class="panel"><div class="section-heading"><p class="muted">预览使用独立内容快照，不会加入个人词书或改变学习进度。</p><button @click="selectPane('history')">返回发布与历史</button></div><p v-if="previewComparison" class="notice">{{ previewComparison }}</p><LibraryBookPreview :content="previewContent" :label="previewLabel" /></section>
          </fieldset>
        </template>
      </template>
    </main>
  </BasePage>
</template>

<style scoped>
.library-editor{max-width:1440px;margin:auto;padding:28px 24px 80px;line-height:1.6}.page-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:24px}.page-header h1{font-size:28px;font-weight:650;margin:10px 0 6px;overflow-wrap:anywhere}.page-header p{font-size:13px;opacity:.7}a{color:var(--color-select-bg,#3477dc)}h2{font-size:19px;font-weight:600;margin-bottom:18px}h3{font-size:16px;font-weight:600}.dirty{color:#b77711;margin-left:10px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:16px 0}.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}button{border:1px solid #8885;border-radius:7px;padding:8px 12px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}button:disabled{opacity:.4;cursor:default}.primary{background:#3477dc;color:#fff;border-color:#3477dc}.danger-text{color:#ce554b}.muted{opacity:.65;font-size:13px}.notice{border:1px solid #3477dc55;background:#3477dc08;border-radius:10px;padding:16px 18px;margin:16px 0;font-size:13px}.notice .actions{margin-top:10px}.notice ul{list-style:disc;padding-left:22px;margin-top:10px}.danger{border-color:#d66c5266;background:#dc795408}.busy{color:var(--color-select-bg,#3477dc);font-size:13px;margin:14px 0}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.section-heading h2{margin-bottom:0}.validation details{margin-top:12px}.validation small{opacity:.7}.issue-link{border:0;text-align:left;padding:3px 0;text-decoration:underline;overflow-wrap:anywhere}.tabs{display:flex;gap:6px;overflow-x:auto;border-bottom:1px solid #8884;margin-top:16px}.tabs button{white-space:nowrap;border:0;border-bottom:3px solid transparent;border-radius:0;padding:13px 16px}.tabs button.active{color:var(--color-select-bg,#3477dc);border-bottom-color:#3477dc}.editor-body{border:0;padding:0;margin:0;min-width:0}.panel{padding:26px 0}.metadata-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:940px}.wide{grid-column:1/-1}label{display:grid;gap:7px;font-size:13px;min-width:0}input,textarea,select{border:1px solid #8886;border-radius:7px;padding:9px 11px;background:transparent;color:inherit;font:inherit;box-sizing:border-box;width:100%;min-width:0}select option{color:CanvasText;background:Canvas}textarea{resize:vertical;line-height:1.6}.check{display:flex;align-items:center;gap:8px}.check input{width:auto;accent-color:#3477dc}.import-panel{margin-top:36px;padding-top:26px;border-top:1px solid #8883}.import-panel>p{max-width:950px;margin:10px 0 18px}.file-input{display:none}.word-tools{display:flex;align-items:end;gap:18px;flex-wrap:wrap;margin-bottom:12px}.word-tools>label:first-child{min-width:240px;flex:1}.word-tools>.check{padding:10px 0}.word-workspace{display:grid;grid-template-columns:minmax(240px,340px) minmax(0,1fr);gap:28px;margin-top:22px}.word-list{min-width:0}.word-list>.muted{margin-bottom:12px}.word-row{display:flex;align-items:center;border-bottom:1px solid #8883;gap:6px;padding:5px 6px;border-radius:6px}.word-row.selected,.unit-list button.selected{background:#3477dc13;outline:1px solid #3477dc66}.word-row>button:last-child{border:0;padding:6px;font-size:12px}.word-select{flex:1;min-width:0;border:0;text-align:left;padding:9px 6px;display:grid;gap:4px}.word-select strong{font-size:14px}.word-select span{font-size:12px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.word-edit-form{border:1px solid #8884;border-radius:12px;padding:24px;align-self:start;min-width:0}.word-edit-form>.section-heading{padding-bottom:15px;border-bottom:1px solid #8883}.pagination{display:flex;align-items:center;justify-content:center;gap:10px;font-size:12px;margin-top:20px}.pagination button{padding:6px 9px;font-size:12px}.membership{margin-top:24px}.unit-checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:15px}.editor-actions{margin-top:24px;padding-top:20px;border-top:1px solid #8883}.unit-workspace{display:grid;grid-template-columns:280px minmax(0,680px);gap:28px;margin-top:24px}.unit-list{display:grid;gap:7px;align-content:start;max-height:700px;overflow:auto;padding:2px}.unit-list button{display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left}.unit-list small{white-space:nowrap;opacity:.65}.unit-id{font-family:monospace;overflow-wrap:anywhere;margin:10px 0 16px}.members-field{margin-top:20px}.publish-note{max-width:900px;margin:20px 0}.history-heading{margin-top:38px;padding-top:24px;border-top:1px solid #8883}.release-row{display:flex;justify-content:space-between;align-items:center;gap:24px;border:1px solid #8883;border-radius:10px;padding:18px;margin-bottom:14px}.release-row p{font-size:13px;white-space:pre-wrap;margin:5px 0;overflow-wrap:anywhere}.release-row strong small{font-size:11px;margin-left:10px;color:#3477dc}.empty{padding:60px 20px;text-align:center}.empty button,.empty a{margin:15px 8px}.empty-small{padding:35px 10px;text-align:center;font-size:13px;opacity:.65}.word-chips{display:flex;flex-wrap:wrap;gap:7px;max-height:210px;overflow:auto;padding:12px 0}.word-chips button{font-size:12px;padding:4px 8px}summary{cursor:pointer}#library-word-editor:focus,#library-unit-editor:focus{outline:2px solid #3477dc77;outline-offset:4px}@media(max-width:960px){.word-workspace{grid-template-columns:260px minmax(0,1fr);gap:18px}.word-edit-form{padding:17px}.unit-workspace{grid-template-columns:220px minmax(0,1fr)}}@media(max-width:720px){.library-editor{padding:20px 12px 60px}.page-header{flex-direction:column;gap:10px}.page-header h1{font-size:23px}.metadata-grid,.word-workspace,.unit-workspace{grid-template-columns:1fr}.word-list{max-height:480px;overflow:auto;padding:2px}.word-edit-form{padding:16px}.unit-list{max-height:280px}.tabs button{padding:11px;font-size:12px}.release-row{align-items:flex-start;flex-direction:column}.section-heading{align-items:flex-start}.word-tools{align-items:stretch;gap:10px}.word-tools>label:first-child{min-width:100%}.notice{padding:12px}.toolbar>.muted{font-size:11px}}
</style>
