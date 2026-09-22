<script setup lang="ts">
import { CloudSync } from '@typewords/core/utils/cloudSync.ts'
import { safeSyncWritable, closeProtectionMessage } from '@typewords/core/utils/safeSync.ts'
import { localDataError } from '@typewords/core/utils/localDataGuard.ts'
import { exportStoredOriginal } from '@typewords/core/utils/archiveIO.ts'
const exportError = ref('')
async function exportOriginal() { try { await exportStoredOriginal() } catch (e) { exportError.value = (e as Error).message } }
const status = ref(CloudSync.getStatus())
const readonly = ref(false)
const closeMessage = ref('')
function refresh() {
  status.value = CloudSync.getStatus(); readonly.value = !safeSyncWritable()
  if (closeMessage.value) closeMessage.value = closeProtectionMessage()
}
function showCloseMessage() { closeMessage.value = closeProtectionMessage() }
function reload() { location.reload() }
onMounted(() => {
  refresh()
  window.addEventListener('typewords-sync-status', refresh)
  window.addEventListener('typewords-sync-readonly', refresh)
  window.addEventListener('typewords-close-pending', showCloseMessage)
})
onUnmounted(() => {
  window.removeEventListener('typewords-sync-status', refresh)
  window.removeEventListener('typewords-sync-readonly', refresh)
  window.removeEventListener('typewords-close-pending', showCloseMessage)
})
</script>
<template>
  <div v-if="localDataError" class="sync-block" role="alert"><div class="card p-6"><h2>本机数据暂时无法读取</h2><p class="my-4">{{ localDataError }} 已暂停保存和同步，原始数据未清空。</p><button @click="exportOriginal">导出原始记录与附件</button><p>{{ exportError }}</p><p class="my-4">请保留导出文件并联系维护者检查，不要清除浏览器数据。</p><button @click="reload">重新检查</button></div></div>
  <div v-else-if="readonly" class="sync-block" role="alert">
    <div class="card p-6">
      <h2>已有另一个页面在保存学习进度</h2>
      <p class="my-4">请保留正在学习的页面。若要在这里继续，先关闭同一浏览器里的其他本站标签页，再重新加载。</p>
      <button @click="reload">重新加载</button>
    </div>
  </div>
  <NuxtLink v-else-if="closeMessage || ['error', 'conflict'].includes(status.status)" to="/account-data" class="sync-notice" role="status">
    {{ closeMessage || status.statusMessage || '同步需要处理，本机数据已保留' }} · 查看
  </NuxtLink>
</template>
<style scoped>
.sync-block { position: fixed; inset: 0; z-index: 100000; background: var(--color-bg, #202124); display: grid; place-items: center; padding: 2rem; }
.sync-block .card { max-width: 32rem; }
.sync-block button { padding: .6rem 1rem; background: #2563eb; color: white; border-radius: .4rem; }
.sync-notice { position: fixed; bottom: 1rem; left: 1rem; z-index: 9000; max-width: min(34rem, 90vw); padding: .7rem 1rem; border-radius: .5rem; background: #78350f; color: #fff; }
</style>
