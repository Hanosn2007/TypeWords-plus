<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { LibraryApi } from '@typewords/core/apis/library.ts'
import { CloudSync } from '@typewords/core/utils/cloudSync.ts'
import type { LibraryFeedback } from '@typewords/core/types/library.ts'
const items = ref<LibraryFeedback[]>([]), busy = ref(false), error = ref(''), loggedIn = ref(false), total = ref(0), offset = ref(0)
const isAdmin = ref(false)
const labels = { open: '待处理', resolved: '已解决', dismissed: '不采纳' }
async function load() {
  busy.value = true; error.value = ''
  try { const result = await LibraryApi.myFeedback(offset.value); items.value = result.items; total.value = result.total }
  catch (e) { error.value = (e as Error).message } finally { busy.value = false }
}
onMounted(async () => {
  loggedIn.value = CloudSync.check()
  if (!loggedIn.value) return
  void load()
  isAdmin.value = await CloudSync.me().then(user => user.is_admin === true).catch(() => false)
})
useHead({ title: '我的词书反馈 · Type Words', meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <BasePage><main class="my-feedback"><header><h1>我的词书反馈</h1><NuxtLink to="/words">返回学习</NuxtLink></header>
    <aside v-if="isAdmin" class="admin-entry"><span>这里仅显示你自己提交的反馈。</span><NuxtLink to="/admin/library/feedback">查看同学反馈 →</NuxtLink></aside>
    <p v-if="!loggedIn">登录后可以查看你提交的反馈。<NuxtLink to="/cloud-login">前往登录</NuxtLink></p>
    <template v-else><p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p><p v-if="busy">正在加载…</p><p v-else-if="!items.length">暂无反馈。背诵共享词书时，可以使用底栏的“反馈词条”。</p>
      <article v-for="item in items" :key="item.id"><div><strong>{{ item.bookName || item.bookId }} · v{{ item.version }} · {{ item.word || '词书内容' }}</strong><span>{{ labels[item.status] }}</span></div><small>{{ new Date(item.createdAt).toLocaleString() }}</small><p>{{ item.message }}</p><blockquote v-if="item.reply"><strong>管理员回复</strong><p>{{ item.reply }}</p></blockquote></article>
      <footer v-if="total"><button :disabled="offset === 0 || busy" @click="offset = Math.max(0, offset - 50); load()">上一页</button><span>共 {{ total }} 条</span><button :disabled="offset + 50 >= total || busy" @click="offset += 50; load()">下一页</button></footer>
    </template></main></BasePage>
</template>

<style scoped>
.admin-entry{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 20px;margin-bottom:24px;border:1px solid #8885;border-radius:10px;font-size:14px}.admin-entry a{color:var(--color-select-bg,#3477dc);font-weight:600}
.my-feedback{max-width:900px;margin:auto;padding:32px 20px}header,article>div,footer{display:flex;justify-content:space-between;gap:16px;align-items:center}h1{font-size:26px;font-weight:650}header{margin-bottom:30px}a{color:#3477dc}article{border:1px solid #8884;border-radius:12px;padding:24px;margin:18px 0}p{white-space:pre-wrap;line-height:1.7;margin-top:14px}small{opacity:.6}blockquote{border-left:3px solid #3477dc;padding:12px 18px;margin-top:18px;background:#3477dc0a}footer{justify-content:center}button{padding:8px 12px;border:1px solid #8885;border-radius:6px}button:disabled{opacity:.5}@media(max-width:600px){header,article>div{align-items:flex-start;flex-direction:column}}
</style>
