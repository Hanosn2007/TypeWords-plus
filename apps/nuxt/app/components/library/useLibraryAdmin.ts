import { ref } from 'vue'
import { CloudSync } from '@typewords/core/utils/cloudSync.ts'

export function useLibraryAdmin() {
  const authorized = ref(false)
  const checking = ref(true)
  const accessError = ref('')
  async function checkAccess() {
    checking.value = true
    accessError.value = ''
    try {
      if (!CloudSync.check()) { accessError.value = '请先登录管理员账号。'; return false }
      const user = await CloudSync.me()
      authorized.value = user.is_admin === true
      if (!authorized.value) accessError.value = '当前账号没有词书管理权限。'
      return authorized.value
    } catch (error) {
      accessError.value = (error as Error).message || '暂时无法验证权限，请稍后重试。'
      return false
    } finally { checking.value = false }
  }
  return { authorized, checking, accessError, checkAccess }
}
