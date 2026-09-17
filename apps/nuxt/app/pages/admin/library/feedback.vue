<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { LibraryApi } from '@typewords/core/apis/library.ts'
import type { LibraryAdminBookSummary, LibraryFeedback, LibraryFeedbackStatus } from '@typewords/core/types/library.ts'
import { useLibraryAdmin } from '~/components/library/useLibraryAdmin'
import { Toast } from '@typewords/base'
const { authorized, checking, accessError, checkAccess } = useLibraryAdmin()
const route = useRoute()
const linkedBookId = () => typeof route.query.bookId === 'string' ? route.query.bookId : ''
const items = ref<LibraryFeedback[]>([]), books = ref<LibraryAdminBookSummary[]>([])
const status = ref('open'), bookId = ref(linkedBookId()), offset = ref(0), total = ref(0), busy = ref(false), error = ref('')
const edits = reactive<Record<number, { status: LibraryFeedbackStatus; reply: string }>>({})
const saving = ref<number | null>(null)
const labels = { open: '待处理', resolved: '已解决', dismissed: '不采纳' }
const kinds = { content: '词条内容', translation: '释义', phonetic: '发音或音标', sentence: '例句', unit: '单元', other: '其他' }
let loadVersion = 0
async function load() {
  const version = ++loadVersion; busy.value = true; error.value = ''
  try {
    const result = await LibraryApi.feedback({ status: status.value, bookId: bookId.value, offset: offset.value })
    if (version !== loadVersion) return
    items.value = result.items; total.value = result.total
    for (const item of result.items) edits[item.id] = { status: item.status, reply: item.reply ?? '' }
  } catch (e) { if (version === loadVersion) error.value = (e as Error).message }
  finally { if (version === loadVersion) busy.value = false }
}
async function save(item: LibraryFeedback) {
  if (saving.value != null) return
  saving.value = item.id
  try { await LibraryApi.updateFeedback(item.id, edits[item.id].status, edits[item.id].reply); Toast.success('反馈处理结果已保存'); await load() }
  catch (e) { Toast.error((e as Error).message) } finally { saving.value = null }
}
watch([status, bookId], () => { offset.value = 0; if (authorized.value) void load() })
watch(() => route.query.bookId, () => { bookId.value = linkedBookId() })
onMounted(async () => { if (await checkAccess()) { books.value = await LibraryApi.adminBooks().catch(() => []); await load() } })
useHead({ title: '同学反馈管理 · Type Words', meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <BasePage><main class="feedback-page">
    <header><h1>同学反馈管理</h1><NuxtLink to="/admin/library">返回词书管理</NuxtLink></header>
    <p v-if="checking">正在验证权限…</p><section v-else-if="!authorized"><p>{{ accessError }}</p><NuxtLink to="/cloud-login">前往登录</NuxtLink></section>
    <template v-else>
      <div class="filters"><label>状态<select v-model="status" :disabled="saving != null"><option value="">全部状态</option><option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option></select></label><label>词书<select v-model="bookId" :disabled="saving != null"><option value="">全部词书</option><option v-for="book in books" :key="book.id" :value="book.id">{{ book.name }}</option></select></label><button :disabled="busy" @click="load">刷新</button></div>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="busy" role="status">正在加载…</p>
      <div v-else-if="!items.length" class="empty"><p>当前没有{{ status === 'open' ? '待处理的' : '匹配的' }}反馈。</p><button v-if="status" @click="status = ''">查看全部状态的反馈</button></div>
      <article v-for="item in items" :key="item.id">
        <div class="item-heading"><strong>{{ item.bookName || item.bookId }} · v{{ item.version }}<span v-if="item.word"> · {{ item.word }}</span></strong><span>{{ labels[item.status] }}</span></div>
        <small>{{ kinds[item.kind] }} · {{ new Date(item.createdAt).toLocaleString() }}</small><p class="message">{{ item.message }}</p>
        <NuxtLink :to="`/admin/library/${item.bookId}?word=${encodeURIComponent(item.word || '')}`">打开当前草稿{{ item.word ? '并定位词条' : '' }}</NuxtLink>
        <div class="reply"><label>处理状态<select v-model="edits[item.id].status" :disabled="saving != null"><option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option></select></label><label>回复<textarea v-model="edits[item.id].reply" rows="2" maxlength="1000" :disabled="saving != null" placeholder="说明修改结果，或不采纳的原因。" /></label><button class="primary" :disabled="saving != null" @click="save(item)">{{ saving === item.id ? '保存中…' : '保存处理结果' }}</button></div>
      </article>
      <footer><button :disabled="offset === 0 || busy" @click="offset = Math.max(0, offset - 50); load()">上一页</button><span>共 {{ total }} 条</span><button :disabled="offset + 50 >= total || busy" @click="offset += 50; load()">下一页</button></footer>
    </template>
  </main></BasePage>
</template>

<style scoped>
.empty button{margin-top:14px}
.feedback-page{max-width:1000px;margin:auto;padding:32px 20px}header,.filters,.item-heading,footer{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:24px}h1{font-size:28px;font-weight:650}a{color:#3477dc}.filters{justify-content:flex-start;flex-wrap:wrap}label{display:grid;gap:6px;font-size:14px}article{padding:24px;border:1px solid #8884;border-radius:12px;margin:18px 0}.item-heading{margin-bottom:8px;align-items:flex-start}small{opacity:.6}.message{white-space:pre-wrap;margin:16px 0;line-height:1.7}.reply{display:grid;grid-template-columns:130px 1fr auto;gap:14px;align-items:end;margin-top:20px}select,textarea,button{padding:8px 12px;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit}button{cursor:pointer}button:disabled{opacity:.5}.primary{background:#3477dc;color:white}.empty{padding:48px;text-align:center;opacity:.7}footer{justify-content:center;margin-top:24px}@media(max-width:650px){.reply{grid-template-columns:1fr}.item-heading{flex-direction:column}header{align-items:flex-start;flex-direction:column}}
</style>
