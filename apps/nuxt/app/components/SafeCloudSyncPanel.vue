<script setup lang="ts">
import { BaseButton, BaseInput, Toast } from '@typewords/base'
import { CloudSync, type AuthResult } from '@typewords/core/utils/cloudSync.ts'
import { prepareAuthentication, resumeSafeSync, suspendSafeSync, syncSafely, previewSync, resolveSync, localRecoveryPoints, type SyncPreview, type RecoveryPoint } from '@typewords/core/utils/safeSync.ts'
import { describeSnapshot, type SafeRow } from '@typewords/core/utils/syncPolicy.ts'
import { useDataSyncPersistence } from '@typewords/core/composables/useDataSyncPersistence.ts'
import { validateEmail } from '@typewords/core/utils/validation.ts'

useDataSyncPersistence()
const mode = ref<'login' | 'register'>('login')
const email = ref(''), password = ref(''), confirmation = ref('')
const user = ref<AuthResult['user'] | null>(null)
const busy = ref(false)
const status = ref(CloudSync.getStatus())
const preview = shallowRef<SyncPreview | null>(null)
const history = ref<Array<{ id: number; revision: number; kind: string; createdAt: string }>>([])
const localPoints = shallowRef<RecoveryPoint[]>([])
const restoreCandidate = shallowRef<{ label: string; rows: SafeRow[] } | null>(null)
const backupStatus = ref<Awaited<ReturnType<typeof CloudSync.backupStatus>> | null>(null)
const selected = ref<'local' | 'remote' | null>(null)
const localSummary = computed(() => preview.value ? describeSnapshot(preview.value.local) : null)
const remoteSummary = computed(() => preview.value ? describeSnapshot(preview.value.remote.rows) : null)
const restoreSummary = computed(() => restoreCandidate.value ? describeSnapshot(restoreCandidate.value.rows) : null)
function refreshStatus() { status.value = CloudSync.getStatus() }
async function run(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  try { await work() } catch (error) { Toast.error((error as Error).message) } finally { busy.value = false; refreshStatus() }
}
async function refreshPoints() {
  localPoints.value = (await localRecoveryPoints()).filter(p => p.account === 0 || p.account === user.value?.id).reverse()
  if (user.value) history.value = await CloudSync.history()
  if (user.value?.is_admin) backupStatus.value = await CloudSync.backupStatus()
}
async function compare() {
  suspendSafeSync()
  preview.value = await previewSync()
  selected.value = null
  restoreCandidate.value = null
  await refreshPoints()
}
async function submit() {
  await run(async () => {
    const address = email.value.trim().toLowerCase()
    if (!validateEmail(address) || password.value.length < 8 || password.value.length > 128) throw new Error('请输入有效邮箱及8–128位密码')
    if (mode.value === 'register' && confirmation.value !== password.value) throw new Error('两次密码不一致')
    // Backup completes before authentication enables any sync path.
    await prepareAuthentication()
    const auth = mode.value === 'register' ? await CloudSync.register(address, password.value) : await CloudSync.login(address, password.value)
    CloudSync.setToken(auth.token); user.value = auth.user
    password.value = ''; confirmation.value = ''
    resumeSafeSync()
    const ok = await syncSafely(true)
    if (ok) { location.href = '/words'; return }
    await compare()
  })
}
async function choose(choice: 'local' | 'remote') { restoreCandidate.value = null; selected.value = choice }
async function confirmChoice() {
  await run(async () => {
    if (!preview.value || (!selected.value && !restoreCandidate.value)) return
    await resolveSync(preview.value, selected.value || 'local', restoreCandidate.value?.rows)
    Toast.success('已保存同步结果，正在重新加载')
    location.href = '/words'
  })
}
async function inspectHistory(id: number, label: string) {
  await run(async () => {
    await compare()
    const snapshot = await CloudSync.historySnapshot(id)
    restoreCandidate.value = { label, rows: snapshot.rows }
    selected.value = 'local'
  })
}
async function inspectLocal(point: RecoveryPoint) {
  await run(async () => { await compare(); restoreCandidate.value = { label: point.createdAt, rows: point.local }; selected.value = 'local' })
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}
async function logout() {
  await run(async () => {
    await prepareAuthentication()
    await CloudSync.logout(); user.value = null; preview.value = null
    Toast.success('已退出；本机数据和恢复副本保留。切换账号会先比较数据。')
  })
}
onMounted(async () => {
  window.addEventListener('typewords-sync-status', refreshStatus)
  if (!CloudSync.check()) return
  await run(async () => { user.value = await CloudSync.me(); await refreshPoints() })
})
onUnmounted(() => { window.removeEventListener('typewords-sync-status', refreshStatus); resumeSafeSync() })
</script>

<template>
  <BasePage>
    <div class="sync-page">
      <h1 class="page-title">云端同步与恢复</h1>
      <div v-if="!user" class="card p-6 mt-6">
        <div class="flex gap-4 mb-5"><button @click="mode = 'login'">登录</button><button @click="mode = 'register'">注册</button></div>
        <div class="flex flex-col gap-4">
          <BaseInput v-model="email" type="email" autocomplete="email" placeholder="邮箱" />
          <BaseInput v-model="password" type="password" :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" placeholder="密码" @keyup.enter="submit" />
          <BaseInput v-if="mode === 'register'" v-model="confirmation" type="password" autocomplete="new-password" placeholder="再次输入密码" />
          <BaseButton type="primary" :loading="busy" @click="submit">{{ mode === 'register' ? '注册并检查同步' : '登录并检查同步' }}</BaseButton>
        </div>
        <p class="muted mt-4">登录前自动保存本机副本。有不同进度时先比较，不直接覆盖。邮箱仅校验格式，不发送验证邮件。</p>
      </div>
      <template v-else>
        <div class="card p-6 mt-6">
          <h2>{{ user.email }}</h2>
          <p role="status" class="my-4">{{ status.statusMessage || '学习进度先保存到本机，再同步到云端。' }}</p>
          <div class="flex gap-3 flex-wrap">
            <BaseButton :disabled="busy" @click="run(async () => { resumeSafeSync(); await syncSafely(false); await refreshPoints() })">立即同步</BaseButton>
            <BaseButton :disabled="busy" @click="run(compare)">比较本机与云端</BaseButton>
            <BaseButton :disabled="busy" @click="logout">退出登录</BaseButton>
          </div>
          <div class="flex gap-4 flex-wrap mt-5">
            <NuxtLink v-if="user.is_admin" to="/admin/library">管理共享词书</NuxtLink>
            <NuxtLink v-if="user.is_admin" to="/admin/library/feedback">处理同学反馈</NuxtLink>
            <NuxtLink to="/library-feedback">我的词书反馈</NuxtLink>
          </div>
        </div>
        <section v-if="preview" class="card p-6 mt-6">
          <h2>选择要继续使用的进度</h2>
          <p class="muted my-3">比较期间自动同步暂停。保存前会再次核对版本，并保留被替换的数据。词数和时长仅帮助识别，系统不会自动取较大的数值。</p>
          <div class="comparison">
            <div v-for="(summary, key) in { local: localSummary, remote: remoteSummary }" :key="key" class="version-card">
              <h3>{{ key === 'local' ? '这台设备' : '云端' }}</h3>
              <p>{{ summary?.completedMinutes }}分钟已结算 · {{ summary?.unfinished }}轮未完成</p>
              <ul><li v-for="book in summary?.books" :key="book.id">{{ book.name }}：已学{{ book.learned }}词</li></ul>
              <BaseButton :disabled="busy" @click="choose(key as 'local' | 'remote')">使用{{ key === 'local' ? '本机' : '云端' }}这份</BaseButton>
            </div>
          </div>
          <div v-if="restoreCandidate" class="my-4">
            <h3>待恢复：{{ restoreCandidate.label }}</h3>
            <p>{{ restoreSummary?.completedMinutes }}分钟已结算 · {{ restoreSummary?.unfinished }}轮未完成</p>
            <p v-for="book in restoreSummary?.books" :key="book.id">{{ book.name }}：已学{{ book.learned }}词</p>
          </div>
          <p v-if="selected" class="my-4">将{{ restoreCandidate ? '恢复选中的历史版本，并同步到云端' : selected === 'local' ? '以本机完整进度更新云端' : '以云端完整进度更新本机' }}。覆盖前的副本可在下方找回。</p>
          <div class="flex gap-3 mt-4">
            <BaseButton v-if="selected" type="primary" :loading="busy" @click="confirmChoice">保存副本并确认使用</BaseButton>
            <BaseButton :disabled="busy" @click="preview = null; selected = null; restoreCandidate = null; resumeSafeSync()">取消</BaseButton>
            <BaseButton @click="download(preview, 'TypeWords-sync-comparison.json')">导出双方副本</BaseButton>
          </div>
        </section>
        <section class="card p-6 mt-6">
          <h2>恢复记录</h2>
          <div v-if="user.is_admin" class="my-4">
            <h3>每日备份</h3>
            <p v-if="!backupStatus?.enabled">服务器每日归档和Mac自动拉取已关闭。同步历史和本机恢复副本仍可用。</p>
            <template v-else>
            <p>{{ backupStatus?.server ? '服务器最近成功备份：' + new Date(backupStatus.server.createdAt).toLocaleString() : '尚无成功的每日备份记录。请完成备份任务配置。' }}</p>
            <p v-if="backupStatus?.server && Date.now() - new Date(backupStatus.server.createdAt).getTime() > 48 * 3600000">服务器超过48小时没有成功备份，请检查任务日志。</p>
            <p>{{ backupStatus?.mac?.file === backupStatus?.server?.file && backupStatus?.mac ? '这台Mac已校验最新备份：' + new Date(backupStatus.mac.verifiedAt).toLocaleString() : 'Mac尚未确认最新备份；开机联网后会补传。' }}</p>
            </template>
          </div>
          <p class="muted my-3">云端保留最近72个小时恢复点、30个日恢复点及最近的手动替换记录。本机只保留最近3份关键操作前的副本，普通练习不另存整份备份；清除浏览器数据会删除本机副本。</p>
          <h3>云端历史</h3>
          <p v-if="!history.length" class="muted">暂无记录，首次成功同步后开始保留。</p>
          <div v-for="point in history" :key="point.id" class="recovery-row">
            <span>{{ new Date(point.createdAt).toLocaleString() }} · 版本{{ point.revision }}</span>
            <button :disabled="busy" @click="inspectHistory(point.id, point.createdAt)">查看并恢复</button>
          </div>
          <h3 class="mt-6">本机副本</h3>
          <div v-for="point in localPoints" :key="point.id" class="recovery-row">
            <span>{{ new Date(point.createdAt).toLocaleString() }} · {{ point.reason }}</span>
            <button :disabled="busy" @click="inspectLocal(point)">查看并恢复</button>
            <button @click="download(point, 'TypeWords-recovery-' + point.id + '.json')">导出</button>
          </div>
        </section>
      </template>
    </div>
  </BasePage>
</template>
<style scoped>
.sync-page { max-width: 56rem; margin: auto; padding: 2rem 1rem; }
.muted { color: var(--color-font-2); line-height: 1.6; }
.comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; }
.version-card { border: 1px solid #7776; padding: 1rem; border-radius: .6rem; }
.version-card ul { margin: 1rem 0; }
.recovery-row { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; padding: .8rem 0; border-bottom: 1px solid #7774; }
.recovery-row button, a { color: var(--color-select-bg, #3b82f6); }
h2, h3 { font-weight: 600; }
</style>
