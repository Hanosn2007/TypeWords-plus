<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { studyUpgrade, acceptStudyUpgrade, exportBeforeStudyUpgrade } from '@typewords/core/composables/studyUpgrade.ts'
import { allowSavedReload, suspendSafeSync } from '@typewords/core/utils/safeSync.ts'
const outdated = ref(false)
const error = ref('')
const saving = ref(false)
function requireUpdate() { suspendSafeSync(); outdated.value = true }
async function saveAndReload() {
  saving.value = true; error.value = ''
  try {
    const waits: Promise<unknown>[] = []
    window.dispatchEvent(new CustomEvent('typewords-save-before-update', { detail: waits }))
    await Promise.all(waits); await allowSavedReload()
    location.reload()
  } catch (e) { error.value = (e as Error).message; saving.value = false }
}
onMounted(() => window.addEventListener('typewords-update-required', requireUpdate))
onUnmounted(() => window.removeEventListener('typewords-update-required', requireUpdate))
</script>
<template>
  <div v-if="studyUpgrade.required || outdated" class="upgrade-backdrop" role="dialog" aria-modal="true" aria-label="学习数据更新">
    <section class="card p-6">
      <h2>{{ outdated ? '需要更新网页' : '单元学习升级' }}</h2>
      <p v-if="outdated">此页面的数据格式已不受支持，同步已停止。请先确认本机保存完成，再刷新更新；若保存失败，请先导出数据。</p>
      <template v-else>
        <p>本次更新让每个单元分别保存练习。更新前会保留本机副本，再转换任务；词序、答题位置和原有学习记录会保留。</p>
        <p v-if="studyUpgrade.error" role="alert">{{ studyUpgrade.error }}</p>
        <button :disabled="studyUpgrade.busy" @click="exportBeforeStudyUpgrade">导出更新前副本</button>
        <button :disabled="studyUpgrade.busy" @click="acceptStudyUpgrade">{{ studyUpgrade.busy ? '正在保存并更新…' : '保存副本并更新' }}</button>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <button v-if="outdated" :disabled="saving" @click="saveAndReload">{{ saving ? '正在保存本机进度…' : '保存本机进度并刷新更新' }}</button>
    </section>
  </div>
</template>
<style scoped>
.upgrade-backdrop{position:fixed;inset:0;z-index:100001;background:#000b;display:grid;place-items:center;padding:1rem}.card{max-width:36rem;background:var(--bg-card,#25272a);color:var(--color-font,#ddd)}p{margin:1rem 0;line-height:1.7}button,a{display:inline-block;padding:.6rem 1rem;border-radius:.4rem;background:#2563eb;color:white;margin:.4rem}button:disabled{opacity:.5}
</style>
