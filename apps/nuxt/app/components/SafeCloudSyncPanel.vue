<script setup lang="ts">
import { CloudSync, type AuthResult } from '@typewords/core/utils/cloudSync.ts'
import { prepareAuthentication, resumeSafeSync, suspendSafeSync, syncSafely, previewSync, resolveSync, previewLocalReplacement, replaceLocalSnapshot, flushActiveEditors, localSaveStatus, type SyncPreview } from '@typewords/core/utils/safeSync.ts'
import { describeSnapshot, type SafeRow } from '@typewords/core/utils/syncPolicy.ts'
import { useDataSyncPersistence } from '@typewords/core/composables/useDataSyncPersistence.ts'
import { listLocalHistory, readLocalHistory, readUnconvertedHistory, deleteLocalHistory, setLocalHistoryDays, type HistoryPoint } from '@typewords/core/utils/localHistory.ts'
import { decodeArchive, type Attachment } from '@typewords/core/utils/dataArchive.ts'
import { readArchiveFile, createArchiveZip, downloadBlob, readLegacySupabase } from '@typewords/core/utils/archiveIO.ts'
import { getDefaultBaseState, getDefaultSettingState, useBaseStore, useSettingStore } from '@typewords/core/stores/index.ts'
import { validateEmail } from '@typewords/core/utils/validation.ts'

const data = useDataSyncPersistence(), base = useBaseStore(), settings = useSettingStore()
const ready = computed(() => base.load && settings.load)
const mode = ref<'login' | 'register'>('login'), email = ref(''), password = ref(''), confirmation = ref('')
const user = ref<AuthResult['user'] | null>(null), busy = ref(false), error = ref(''), notice = ref(''), historyError = ref(''), cloudError = ref('')
const status = ref(CloudSync.getStatus()), localStatus = ref(localSaveStatus())
const local = shallowRef<Awaited<ReturnType<typeof listLocalHistory>>>({ owner: 0, days: 3, points: [] })
const cloud = shallowRef<Awaited<ReturnType<typeof CloudSync.history>>>([])
const preview = shallowRef<SyncPreview | null>(null), selected = ref<'local' | 'remote' | null>(null)
const candidate = shallowRef<{ label: string; rows: SafeRow[]; files: Attachment[]; signature: string; owner: number; before: SafeRow[] } | null>(null)
const pendingFile = shallowRef<{ value: any; files: Attachment[] } | null>(null)
const hasLegacy = ref(false), proposedDays = ref(3)
const confirmationAction = shallowRef<{ text: string; perform: () => Promise<void> } | null>(null)
async function confirmAction() { const action = confirmationAction.value; if (!action) return; confirmationAction.value = null; await run(action.perform) }
function refreshStatus() { status.value = CloudSync.getStatus(); localStatus.value = localSaveStatus() }
function historyFailure(event: Event) { historyError.value = (event as CustomEvent).detail }
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) }
function summary(rows: SafeRow[]) { return describeSnapshot(rows) }
function downloadJSON(value: unknown, name: string) { downloadBlob(new Blob([JSON.stringify(value)], { type: 'application/json' }), name) }
async function run(fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await fn() } catch (e) { error.value = (e as Error).message } finally { busy.value = false; refreshStatus() }
}
async function refreshLocal() {
  try { local.value = await listLocalHistory(); proposedDays.value = local.value.days }
  catch (e) { historyError.value = (e as Error).message }
}
async function refreshCloud() {
  cloudError.value = ''
  if (!user.value) { cloud.value = []; return }
  try { cloud.value = await CloudSync.history() } catch (e) { cloudError.value = (e as Error).message }
}
async function compare() {
  suspendSafeSync()
  try { preview.value = await previewSync(); selected.value = null; candidate.value = null }
  catch (e) { resumeSafeSync(); throw e }
}
function cancel() { preview.value = null; candidate.value = null; selected.value = null; pendingFile.value = null; resumeSafeSync() }
async function submit() {
  await run(async () => {
    const address = email.value.trim().toLowerCase()
    if (!validateEmail(address) || password.value.length < 8 || password.value.length > 128) throw Error('请输入有效邮箱及8–128位密码。')
    if (mode.value === 'register' && confirmation.value !== password.value) throw Error('两次密码不一致。')
    await prepareAuthentication()
    try {
      const auth = mode.value === 'register' ? await CloudSync.register(address, password.value) : await CloudSync.login(address, password.value)
      CloudSync.setToken(auth.token); user.value = auth.user; password.value = ''; confirmation.value = ''
      await compare(); await refreshCloud()
    } catch (e) { resumeSafeSync(); throw e }
  })
}
async function logout() {
  await run(async () => {
    await prepareAuthentication()
    try { await CloudSync.logout() } finally { user.value = null; cancel(); cloud.value = [] }
    notice.value = '已退出，本机进度与历史仍保留。'
  })
}
async function stage(rows: SafeRow[], files: Attachment[], label: string) {
  suspendSafeSync()
  try {
    rows = await data.prepareReplacement(rows, files)
    const state = await previewLocalReplacement()
    candidate.value = { rows, files, label, ...state, before: await data.readSafeSnapshot() }
    preview.value = null; pendingFile.value = null
  } catch (e) { resumeSafeSync(); throw e }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file) return
  await run(async () => {
    const archive = await readArchiveFile(file)
    if (Array.isArray(archive.value?.local) && archive.value?.remote) { pendingFile.value = archive; return }
    await stage(decodeArchive(archive.value), archive.files, file.name)
  })
}
async function selectFileSide(side: 'local' | 'remote') {
  const file = pendingFile.value!
  await stage(decodeArchive(file.value, side), file.files, '比较文件中的' + (side === 'local' ? '本机' : '云端') + '数据')
}
async function restore() {
  const c = candidate.value!
  await replaceLocalSnapshot(c.rows, '恢复', { files: c.files, expected: c.signature, owner: c.owner })
  cancel(); await refreshLocal()
  notice.value = '已恢复到本机。登录后请比较云端，再确认同步；当天较早的状态不另行保留。'
}
async function confirmSync() {
  if (!preview.value || !selected.value) return
  await resolveSync(preview.value, selected.value)
  cancel(); await refreshLocal(); await refreshCloud()
  notice.value = '已确认同步。'
}
async function exportRows(rows: SafeRow[], files: Attachment[], name: string) {
  downloadBlob(await createArchiveZip(rows, files), name + '.zip')
}
async function exportCurrent() {
  try { await flushActiveEditors() } catch { notice.value = '本机保存仍未成功，本文件包含可读取的当前词书与最后成功保存的任务。请保留页面。' }
  const a = await data.readArchive(); await exportRows(a.rows, a.files, 'TypeWords-current')
}
async function inspectLocal(point: HistoryPoint, exporting = false) {
  const a = await readLocalHistory(point)
  if (exporting) await exportRows(a.rows, a.files, 'TypeWords-local-' + point.id)
  else await stage(decodeArchive({ rows: a.rows }), a.files, point.label || point.day + ' 本机历史')
}
async function inspectCloud(id: string, exporting = false) {
  const a = await CloudSync.historySnapshot(id)
  if (exporting) downloadJSON(a, 'TypeWords-cloud-' + id + '.json')
  else await stage(decodeArchive(a), [], '云端历史 ' + id)
}
async function retention() {
  const days = proposedDays.value
  const perform = async () => { await setLocalHistoryDays(days); await refreshLocal() }
  if (days < local.value.days) { confirmationAction.value = { text: '调小保留数量会移除超额日期的本机历史，当前进度和云端历史不变。确定继续？', perform }; return }
  await perform()
}
async function removeLocal(point: HistoryPoint) {
  const perform = async () => { await deleteLocalHistory(point, !!point.deletedAt); await refreshLocal() }
  if (!point.deletedAt) { confirmationAction.value = { text: '删除这份本机历史？24小时内可撤销，当前学习进度不变。', perform }; return }
  await perform()
}
async function removeCloud(point: (typeof cloud.value)[number]) {
  const perform = async () => {
    if (point.deletedAt) await CloudSync.undoHistoryDelete(point.id); else await CloudSync.deleteHistory(point.id)
    await refreshCloud()
  }
  if (!point.deletedAt) { confirmationAction.value = { text: '删除这份云端历史？24小时内可撤销，本机历史及当前进度不变。', perform }; return }
  await perform()
}
async function resetPreview() {
  await stage([
    { type: 'dict', data: getDefaultBaseState(), data_version: 4 },
    { type: 'setting', data: getDefaultSettingState(), data_version: 25 },
    { type: 'practice_word', data: null, data_version: 3 },
    { type: 'practice_article', data: null, data_version: 1 },
  ], [], '清空本机学习数据并重置设置')
}
onMounted(async () => {
  window.addEventListener('typewords-sync-status', refreshStatus)
  window.addEventListener('typewords-history-error', historyFailure)
  hasLegacy.value = !!localStorage.getItem('supabase_config')
  await refreshLocal()
  if (CloudSync.check()) await run(async () => { user.value = await CloudSync.me(); await refreshCloud() })
})
onUnmounted(() => { window.removeEventListener('typewords-sync-status', refreshStatus); window.removeEventListener('typewords-history-error', historyFailure); resumeSafeSync() })
</script>

<template>
  <BasePage>
    <div class="data-page">
      <h1>账号与数据</h1>
      <p class="muted">学习进度先保存在这台浏览器。离开窗口后同步，版本冲突由你比较和选择。</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <div v-if="confirmationAction" class="confirmation" role="alertdialog" aria-modal="true" aria-label="确认历史操作"><div class="card"><h2>确认历史操作</h2><p>{{ confirmationAction.text }}</p><div class="actions"><button @click="confirmAction">确认操作</button><button @click="confirmationAction = null; proposedDays = local.days">取消操作</button></div></div></div>
      <fieldset :disabled="busy || !ready">
        <section class="card">
          <h2>本机数据</h2>
          <p role="status">{{ !ready ? '正在读取本机数据…' : localStatus.failed ? '本机保存失败，请保留页面并导出当前数据。' : localStatus.pending ? '正在保存到本机…' : '本机数据可用' }}</p>
          <div class="actions">
            <button @click="run(exportCurrent)">导出完整数据 ZIP</button>
            <label class="file-button">导入完整数据<input type="file" accept=".json,.zip" @change="importFile" /></label>
            <button @click="run(refreshLocal)">刷新本机历史</button>
          </div>
          <p class="muted">离线也可导出和恢复。导入会先预览；词书内容文件请到书库导入。清除浏览器数据会删除本机进度和本机历史。</p>
          <details><summary>旧数据与重置</summary><div class="actions">
            <button v-if="hasLegacy" @click="run(async () => stage(await readLegacySupabase(), [], '旧 Supabase 数据'))">只读获取旧 Supabase 数据并预览</button>
            <button @click="run(resetPreview)">预览清空本机数据</button>
          </div></details>
        </section>
        <section v-if="pendingFile" class="card">
          <h2>这份文件包含两端数据</h2><p>请选择要预览的一份。</p>
          <div class="actions"><button @click="run(() => selectFileSide('local'))">文件中的本机数据</button><button @click="run(() => selectFileSide('remote'))">文件中的云端数据</button><button @click="cancel">取消</button></div>
        </section>
        <section v-if="candidate" class="card">
          <h2>确认本机替换：{{ candidate.label }}</h2>
          <div class="comparison">
            <div v-for="(rows, label) in { '当前本机': candidate.before, '准备使用': candidate.rows }" :key="label">
              <h3>{{ label }}</h3><p>{{ summary(rows).completedMinutes }} 分钟已结算 · {{ summary(rows).unfinished }} 轮未完成</p>
              <p v-for="book in summary(rows).books" :key="book.id">{{ book.name }}：已学 {{ book.learned }} 词</p>
            </div>
          </div>
          <p>将替换本机完整学习数据。不会立即覆盖云端；每天只保留最新一份历史，当天旧状态可能无法恢复。保存时间不代表学习发生时间。</p>
          <div class="actions"><button @click="run(restore)">确认替换本机</button><button @click="cancel">取消</button></div>
        </section>
        <section class="card">
          <template v-if="!user">
            <h2>本站账号</h2>
            <form @submit.prevent="submit">
              <div class="actions"><button type="button" @click="mode = 'login'">登录</button><button type="button" @click="mode = 'register'">注册</button></div>
              <label>邮箱<input v-model="email" type="email" autocomplete="email" required /></label>
              <label>密码<input v-model="password" type="password" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" required /></label>
              <label v-if="mode === 'register'">确认密码<input v-model="confirmation" type="password" autocomplete="new-password" /></label>
              <button type="submit">{{ mode === 'register' ? '注册并比较数据' : '登录并比较数据' }}</button>
            </form><p class="muted">使用本站账号；原上游账号不能在这里登录。邮箱仅校验格式，不发送验证邮件。</p>
          </template>
          <template v-else>
            <h2>{{ user.email }}</h2><p role="status">{{ status.statusMessage || '云端尚未检查' }}</p>
            <div class="actions"><button @click="run(async () => { cancel(); await syncSafely(false); await refreshLocal(); await refreshCloud() })">立即同步</button><button @click="run(compare)">比较本机与云端</button><button @click="logout">退出登录</button></div>
            <div class="actions"><NuxtLink v-if="user.is_admin" to="/admin/library">管理共享词书</NuxtLink><NuxtLink v-if="user.is_admin" to="/admin/library/feedback">处理同学反馈</NuxtLink><NuxtLink to="/library-feedback">我的词书反馈</NuxtLink></div>
          </template>
        </section>
        <section v-if="preview" class="card">
          <h2>选择完整进度</h2><p>比较期间自动同步暂停。系统不会根据词数或时长替你选择。</p>
          <div class="comparison">
            <div v-for="(rows, side) in { local: preview.local, remote: preview.remote.rows }" :key="side">
              <h3>{{ side === 'local' ? '本机' : '云端' }}</h3>
              <p>{{ summary(rows).completedMinutes }} 分钟已结算 · {{ summary(rows).unfinished }} 轮未完成</p>
              <p v-for="book in summary(rows).books" :key="book.id">{{ book.name }}：已学 {{ book.learned }} 词</p>
              <button :disabled="rows.length !== 4" @click="selected = side">{{ selected === side ? '已选择：' : '使用' }}{{ side === 'local' ? '本机' : '云端' }}这份</button>
            </div>
          </div>
          <p v-if="selected">将以{{ selected === 'local' ? '本机完整数据更新云端' : '云端完整数据替换本机' }}。同日旧状态不另存。</p>
          <div class="actions"><button :disabled="!selected" @click="run(confirmSync)">确认使用</button><button @click="cancel">取消</button><button @click="downloadJSON(preview, 'TypeWords-comparison.json')">导出双方比较文件</button></div>
        </section>
        <section class="card">
          <h2>本机历史</h2><p>按北京时间，每个有效日期仅最新一份。保留日期数不是操作次数；旧版副本另行列出，不自动清理。</p>
          <div class="actions"><label>保留 <select v-model.number="proposedDays"><option v-for="n in 30" :key="n" :value="n">{{ n }}</option></select> 个有效日期</label><button @click="run(retention)">应用</button></div>
          <p v-if="historyError" class="error">{{ historyError }}</p>
          <div v-for="item in local.errors" :key="item.id" class="history-row"><p>{{ item.label }}：{{ item.message }}。原件未修改。</p><button @click="run(async () => downloadJSON(await readUnconvertedHistory(item.id), 'TypeWords-legacy-original.json'))">导出旧原件</button></div>
          <p v-if="!local.points.length">暂无本机历史。学习数据变更后，在离开窗口或手动同步时更新。</p>
          <article v-for="point in local.points" :key="point.id" class="history-row">
            <div><strong>{{ point.label || point.day }}</strong> · {{ point.owner ? '账号 ' + point.owner : '访客/旧记录' }}<span v-if="point.deletedAt"> · 最近删除</span><p>保存：{{ time(point.savedAt) }}（北京时间）</p><p>{{ point.summary.books.map(b => b.name + ' ' + b.learned + '词').join('；') }} · {{ point.summary.unfinished }}轮未完成</p></div>
            <div class="actions"><button v-if="!point.deletedAt" @click="run(() => inspectLocal(point))">预览恢复</button><button @click="run(() => inspectLocal(point, true))">导出</button><button @click="run(() => removeLocal(point))">{{ point.deletedAt ? '撤销删除' : '删除' }}</button></div>
          </article>
          <p class="muted">手动删除可在24小时内撤销；同日已有新副本时，旧副本仍可先导出。</p>
        </section>
        <section class="card">
          <h2>云端历史</h2><p>保留最近3个实际收到变更的有效日期，每日仅最新一份；离线期间的中间日期只在本机保留。</p>
          <p v-if="!user">登录后可查看云端历史，本机历史不需要登录。</p>
          <template v-else><button @click="run(refreshCloud)">刷新云端历史</button><p v-if="cloudError" class="error">{{ cloudError }}</p>
            <article v-for="point in cloud" :key="point.id" class="history-row">
              <div><strong>{{ point.kind.startsWith('legacy-') ? '旧版副本' : point.day }}</strong> · 版本{{ point.revision }}<span v-if="point.deletedAt"> · 最近删除</span><p>保存：{{ time(point.createdAt) }}（北京时间）</p><p v-if="point.summary.books">{{ point.summary.books.map(b => b.name + ' ' + (b.learned ?? 0) + '词').join('；') }}</p></div>
              <div class="actions"><button v-if="!point.deletedAt" @click="run(() => inspectCloud(point.id))">预览恢复到本机</button><button @click="run(() => inspectCloud(point.id, true))">导出</button><button @click="run(() => removeCloud(point))">{{ point.deletedAt ? '撤销删除' : '删除' }}</button></div>
            </article>
            <p v-if="!cloud.length && !cloudError">暂无云端历史。</p>
          </template>
        </section>
      </fieldset>
    </div>
  </BasePage>
</template>
<style scoped>
.data-page { max-width: 62rem; margin: auto; padding: 1.5rem; overflow-wrap: anywhere; }
h1 { font-size: 1.6rem; font-weight: 700; } h2 { font-size: 1.15rem; font-weight: 600; } h3 { font-weight: 600; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.card { padding: 1.3rem; margin-top: 1.2rem; } p { margin: .65rem 0; line-height: 1.6; }
.actions { display: flex; flex-wrap: wrap; gap: .7rem; align-items: center; margin: .8rem 0; }
button, .file-button { border: 1px solid #8887; border-radius: .4rem; padding: .45rem .7rem; cursor: pointer; color: var(--color-main-text); background: var(--color-third); }
button:disabled, fieldset:disabled button { opacity: .5; cursor: wait; }
form { max-width: 28rem; display: grid; gap: .8rem; } form label { display: grid; gap: .4rem; }
input:not([type=file]), select { min-width: 0; max-width: 100%; padding: .5rem; border: 1px solid #8887; border-radius: .3rem; background: var(--color-second); color: inherit; }
input[type=file] { width: 0; position: absolute; opacity: 0; }
.comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 1rem; margin: 1rem 0; }
.comparison > div { border: 1px solid #8886; padding: 1rem; border-radius: .5rem; min-width: 0; }
.history-row { border-bottom: 1px solid #8885; padding: .8rem 0; }
.muted { opacity: .75; } .error { color: #e16b6b; } a { color: var(--color-select-bg, #3b82f6); }
.confirmation { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: #0008; padding: 1rem; }
.confirmation .card { max-width: 30rem; background: var(--color-second); }
@media (max-width: 600px) { .data-page { padding: .75rem; } .card { padding: .85rem; } }
</style>
