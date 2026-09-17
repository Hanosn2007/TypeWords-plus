<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { Toast } from '@typewords/base'
import { LibraryApi } from '@typewords/core/apis/library.ts'
import { emptyLibraryContent } from '@typewords/core/utils/libraryImport.ts'
import type { LibraryAdminBookSummary } from '@typewords/core/types/library.ts'
import { useLibraryAdmin } from '~/components/library/useLibraryAdmin'

useHead({ title: '词书管理 · Type Words', meta: [{ name: 'robots', content: 'noindex' }] })
const { authorized, checking, accessError, checkAccess } = useLibraryAdmin()
const books = ref<LibraryAdminBookSummary[]>([])
const search = ref('')
const busy = ref(false)
const error = ref('')
const router = useRouter()
const visibleBooks = computed(() => books.value.filter(book => book.name.toLowerCase().includes(search.value.toLowerCase())))
async function load() {
  busy.value = true; error.value = ''
  try { books.value = await LibraryApi.adminBooks() } catch (e) { error.value = (e as Error).message } finally { busy.value = false }
}
async function create() {
  if (busy.value) return
  busy.value = true
  try { const book = await LibraryApi.create(emptyLibraryContent()); await router.push(`/admin/library/${book.id}`) }
  catch (e) { Toast.error((e as Error).message) } finally { busy.value = false }
}
onMounted(async () => { if (await checkAccess()) await load() })
</script>

<template>
  <BasePage>
    <main class="library-admin">
      <header><div><h1>词书管理</h1><p>维护内容、发布版本，统一处理同学的反馈。</p></div><NuxtLink to="/dict-list">返回书库</NuxtLink></header>
      <p v-if="checking" role="status">正在验证权限…</p>
      <section v-else-if="!authorized" class="empty"><p>{{ accessError }}</p><NuxtLink to="/cloud-login">前往登录</NuxtLink><button @click="checkAccess().then(ok => ok && load())">重试</button></section>
      <template v-else>
        <nav><label>搜索词书 <input v-model="search" placeholder="词书名称" /></label><div><NuxtLink to="/admin/library/feedback">处理同学反馈</NuxtLink><button class="primary" :disabled="busy" @click="create">创建词书</button></div></nav>
        <p v-if="error" role="alert">{{ error }} <button @click="load">重新加载</button></p>
        <p v-if="busy" role="status">正在加载…</p>
        <section v-else-if="!books.length" class="empty"><h2>创建第一本共享词书</h2><p>导入现有词表，检查内容后发布，同学就能在内置书库中找到。</p><button class="primary" @click="create">创建词书</button></section>
        <div v-else class="book-grid">
          <NuxtLink v-for="book in visibleBooks" :key="book.id" :to="`/admin/library/${book.id}`" class="book-card">
            <div class="status">{{ !book.publishedVersion ? '草稿' : book.hasUnpublishedChanges ? '有待发布修改' : `已发布 v${book.publishedVersion}` }}</div>
            <h2>{{ book.name }}</h2><p>{{ book.length }} 个词 · {{ book.unitsCount }} 个单元</p>
            <small>更新于 {{ new Date(book.updatedAt).toLocaleString() }}<span v-if="book.recommended"> · 推荐</span></small>
          </NuxtLink>
          <p v-if="!visibleBooks.length">没有匹配的词书。</p>
        </div>
      </template>
    </main>
  </BasePage>
</template>

<style scoped>
.library-admin{max-width:1100px;margin:auto;padding:32px 20px}header,nav{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:28px}h1{font-size:28px;font-weight:650}h2{font-size:19px;font-weight:600}p,small{opacity:.7;margin-top:8px}a{color:var(--color-select-bg,#4085df)}nav>div{display:flex;align-items:center;gap:20px}input,button{border:1px solid var(--color-input-border,#bbb);border-radius:8px;padding:9px 14px;background:transparent;color:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}.primary{background:#3477dc;color:white;border-color:#3477dc}.empty{padding:64px 24px;text-align:center;border:1px dashed #aaa;border-radius:14px}.empty a,.empty button{display:inline-block;margin:20px 8px 0}.book-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px}.book-card{padding:24px;border:1px solid #8884;border-radius:14px;color:inherit;text-decoration:none}.book-card:hover{border-color:#3477dc}.status{font-size:12px;color:#3477dc;margin-bottom:15px}@media(max-width:650px){header,nav{align-items:flex-start;flex-direction:column}.library-admin{padding:22px 12px}input{max-width:100%}}
</style>
