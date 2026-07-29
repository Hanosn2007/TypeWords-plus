<script setup lang="ts">
import { BaseButton, BaseInput, PopConfirm, Toast } from '@typewords/base'
import { useDataSyncPersistence } from '@typewords/core/composables/useDataSyncPersistence.ts'
import { useExport } from '@typewords/core/hooks/export.ts'
import { SyncDataType } from '@typewords/core/types/enum.ts'
import { CloudSync } from '@typewords/core/utils/cloudSync.ts'
import { validateEmail } from '@typewords/core/utils/validation.ts'
import { onMounted } from 'vue'

type Mode = 'login' | 'register'

let mode = $ref<Mode>('login')
let email = $ref('')
let password = $ref('')
let confirmPassword = $ref('')
let loading = $ref(false)
let currentUser = $ref<{ id: number; email: string } | null>(null)

const dataSync = useDataSyncPersistence()
const { getExportedData } = useExport()

function validateForm(): boolean {
  email = email.trim().toLowerCase()
  if (!validateEmail(email)) {
    Toast.warning('请输入有效的邮箱地址')
    return false
  }
  if (password.length < 8 || password.length > 128) {
    Toast.warning('密码长度需要为 8-128 位')
    return false
  }
  if (mode === 'register' && password !== confirmPassword) {
    Toast.warning('两次输入的密码不一致')
    return false
  }
  return true
}

async function pushLocalData() {
  const local = await getExportedData()
  const ok = await dataSync.forcePushLocalDataToRemote(local.val)
  if (!ok) throw new Error('上传本机数据失败')
}

async function pullRemoteData() {
  const ok = await dataSync.pullAllRemoteToLocal()
  if (!ok) throw new Error('下载云端数据失败')
}

async function finishAuthentication(isNewAccount: boolean) {
  if (isNewAccount) {
    await pushLocalData()
  } else {
    const rows = await CloudSync.fetchMeta([
      SyncDataType.dict,
      SyncDataType.setting,
      SyncDataType.practice_word,
      SyncDataType.practice_article,
    ])
    if (rows.length) {
      await pullRemoteData()
    } else {
      await pushLocalData()
    }
  }
  location.href = '/words'
}

async function submit() {
  if (loading || !validateForm()) return
  loading = true
  let authenticated = false
  try {
    const result =
      mode === 'register' ? await CloudSync.register(email, password) : await CloudSync.login(email, password)
    CloudSync.setToken(result.token)
    authenticated = true
    currentUser = result.user
    password = ''
    confirmPassword = ''
    Toast.success(mode === 'register' ? '注册成功，正在上传本机数据' : '登录成功，正在同步云端数据')
    await finishAuthentication(mode === 'register')
  } catch (error) {
    if (!authenticated) CloudSync.clearToken()
    Toast.error((error as Error)?.message || '操作失败')
  } finally {
    loading = false
  }
}

async function refreshFromCloud() {
  if (loading) return
  loading = true
  try {
    await pullRemoteData()
    Toast.success('云端数据已同步到本机')
    location.href = '/words'
  } catch (error) {
    Toast.error((error as Error)?.message || '同步失败')
  } finally {
    loading = false
  }
}

async function overwriteCloud() {
  if (loading) return
  loading = true
  try {
    await pushLocalData()
    Toast.success('本机数据已覆盖云端')
  } catch (error) {
    Toast.error((error as Error)?.message || '同步失败')
  } finally {
    loading = false
  }
}

async function logout() {
  if (loading) return
  loading = true
  try {
    await CloudSync.logout()
    currentUser = null
    password = ''
    confirmPassword = ''
    Toast.success('已退出登录')
  } finally {
    loading = false
  }
}

onMounted(async () => {
  if (!CloudSync.check()) return
  try {
    currentUser = await CloudSync.me()
  } catch {
    CloudSync.clearToken()
  }
})
</script>

<template>
  <BasePage>
    <div class="mx-auto max-w-120 px-4 py-12">
      <div class="page-title text-center mb-8">云端同步</div>

      <div v-if="currentUser" class="card p-6">
        <div class="text-lg font-medium">{{ currentUser.email }}</div>
        <div class="text-sm color-gray mt-2">登录后，词典、设置和学习进度会在设备间同步。</div>

        <div class="flex flex-col gap-3 mt-8">
          <BaseButton size="large" type="primary" :loading="loading" @click="refreshFromCloud">
            从云端同步到本机
          </BaseButton>
          <PopConfirm title="确认使用本机数据覆盖云端？" @confirm="overwriteCloud">
            <BaseButton size="large" :disabled="loading">用本机数据覆盖云端</BaseButton>
          </PopConfirm>
          <BaseButton size="large" type="info" :disabled="loading" @click="logout">退出登录</BaseButton>
        </div>
      </div>

      <div v-else class="card p-6">
        <div class="flex mb-6 border-bottom">
          <button class="mode-tab" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
          <button class="mode-tab" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
        </div>

        <div class="flex flex-col gap-4">
          <BaseInput v-model="email" type="email" name="email" autocomplete="email" size="large" placeholder="邮箱" />
          <BaseInput
            v-model="password"
            type="password"
            name="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            size="large"
            placeholder="密码（至少 8 位）"
            @keyup.enter="submit"
          />
          <BaseInput
            v-if="mode === 'register'"
            v-model="confirmPassword"
            type="password"
            name="confirmPassword"
            autocomplete="new-password"
            size="large"
            placeholder="再次输入密码"
            @keyup.enter="submit"
          />
        </div>

        <BaseButton class="w-full mt-6" size="large" type="primary" :loading="loading" @click="submit">
          {{ mode === 'register' ? '注册并上传本机数据' : '登录并同步' }}
        </BaseButton>
        <div class="text-sm color-gray mt-4">邮箱只校验格式，不发送验证邮件。</div>
      </div>
    </div>
  </BasePage>
</template>

<style scoped lang="scss">
.mode-tab {
  flex: 1;
  padding: 0.75rem;
  border-bottom: 2px solid transparent;
  color: var(--color-font-2);

  &.active {
    border-color: var(--color-select-bg);
    color: var(--color-font-1);
    font-weight: 600;
  }
}
</style>
