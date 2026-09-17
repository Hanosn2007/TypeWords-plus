<script setup lang="ts">
import { defineAsyncComponent, inject, onBeforeUnmount, ref, watch } from 'vue'
import { Toast } from '@typewords/base'
import { useDisableEventListener } from '@typewords/utils'
import { LibraryApi, LibraryApiError } from '../../apis/library.ts'
import { CloudSync } from '../../utils/cloudSync.ts'
import { usePracticeStore } from '../../stores/practice.ts'
import type { LibraryFeedbackKind } from '../../types/library.ts'

const props = defineProps<{ library: { bookId: string; version: number }; bookName: string; word?: string }>()
const Dialog = defineAsyncComponent(() => import('@typewords/base/Dialog.vue'))
const open = ref(false), busy = ref(false), loggedIn = ref(false), message = ref(''), error = ref('')
const kind = ref<LibraryFeedbackKind>('translation')
const context = ref({ bookId: '', version: 0, name: '', word: '' })
const toggleTimer = inject<(() => void) | undefined>('togglePracticeTimer', undefined)
const stat = usePracticeStore()
let resumeOnClose = false
useDisableEventListener(() => open.value)
function show() {
  context.value = { ...props.library, name: props.bookName, word: props.word ?? '' }
  loggedIn.value = CloudSync.check(); error.value = ''
  resumeOnClose = !!toggleTimer && !stat.timerPaused
  if (resumeOnClose) toggleTimer!()
  open.value = true
}
watch(open, value => {
  if (!value && resumeOnClose) { resumeOnClose = false; if (stat.timerPaused) toggleTimer?.() }
})
onBeforeUnmount(() => { resumeOnClose = false })
async function submit() {
  if (busy.value || !message.value.trim()) return
  busy.value = true; error.value = ''
  try {
    await LibraryApi.submitFeedback(context.value.bookId, { version: context.value.version, word: context.value.word || undefined, kind: kind.value, message: message.value.trim() })
    message.value = ''; open.value = false; Toast.success('反馈已提交，可以继续学习。')
  } catch (e) {
    if (e instanceof LibraryApiError && e.status === 401) loggedIn.value = false
    error.value = (e as Error).message
  } finally { busy.value = false }
}
</script>

<template>
  <button class="feedback-trigger" :aria-label="word ? `反馈词条 ${word}` : '反馈词书'" @click="show">反馈{{ word ? '词条' : '词书' }}</button>
  <Dialog v-model="open" title="反馈词书内容" padding :footer="false">
    <form class="feedback-form" @submit.prevent="submit">
      <p>{{ context.name }} · v{{ context.version }}<strong v-if="context.word"> · {{ context.word }}</strong></p>
      <template v-if="loggedIn">
        <label>问题类型<select v-model="kind" :disabled="busy"><option value="translation">释义</option><option value="phonetic">发音或音标</option><option value="sentence">例句</option><option value="unit">单元归属</option><option value="content">词条内容</option><option value="other">其他</option></select></label>
        <label>说明<textarea v-model="message" rows="5" maxlength="1000" required :disabled="busy" placeholder="哪里有问题？也可以写下建议的正确内容。" /></label>
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="actions"><button type="button" :disabled="busy" @click="open = false">取消</button><button class="primary" type="submit" :disabled="busy || !message.trim()">{{ busy ? '正在提交…' : '提交反馈' }}</button></div>
      </template>
      <template v-else><p>登录后可以提交并查看处理结果。你也可以先关闭窗口继续学习。</p><a href="/cloud-login" target="_blank" rel="noopener">打开登录页面</a><button type="button" @click="loggedIn = CloudSync.check()">已登录，重试</button></template>
    </form>
  </Dialog>
</template>

<style scoped>
.feedback-trigger{font-size:12px;padding:6px 8px;color:var(--color-main-text,#666);border:1px solid #8884;border-radius:6px;white-space:nowrap}.feedback-form{width:min(420px,calc(100vw - 64px));display:grid;gap:16px}.feedback-form p{font-size:14px;line-height:1.6}.feedback-form label{display:grid;gap:6px}select,textarea{width:100%;padding:9px;border:1px solid #8886;border-radius:8px;background:var(--color-bg,transparent);color:inherit}.actions{display:flex;gap:12px;justify-content:flex-end}button{padding:8px 14px;border-radius:7px;border:1px solid #8885;cursor:pointer}button:disabled{opacity:.5}.primary{background:#3477dc;color:white}a{color:#3477dc}
</style>
