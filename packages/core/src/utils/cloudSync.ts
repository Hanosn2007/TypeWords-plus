import { useRuntimeStore } from '../stores'

export const CLOUD_TOKEN_KEY = 'typewords_cloud_token'

export type CloudSyncStatus = 'idle' | 'syncing' | 'success' | 'error'

export type CloudSyncRow = {
  type: string
  data?: unknown
  updated_at?: string
  data_version?: number
  revision?: number
}

type ApiResponse<T> = {
  success: boolean
  code: number
  msg?: string
  data: T
}

type AuthResult = {
  token: string
  user: {
    id: number
    email: string
  }
}

let status: CloudSyncStatus = 'idle'
let statusMessage = ''

function getToken(): string {
  if (!import.meta.client) return ''
  return localStorage.getItem(CLOUD_TOKEN_KEY) ?? ''
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
  })
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null
  if (!response.ok || !body?.success) {
    if (response.status === 401 && import.meta.client) {
      localStorage.removeItem(CLOUD_TOKEN_KEY)
    }
    throw new Error(body?.msg || `Request failed (${response.status})`)
  }
  return body.data
}

export class CloudSync {
  static check(): boolean {
    return !!getToken()
  }

  static setToken(token: string): void {
    localStorage.setItem(CLOUD_TOKEN_KEY, token)
    this.setStatus('idle')
  }

  static clearToken(): void {
    localStorage.removeItem(CLOUD_TOKEN_KEY)
    this.setStatus('idle')
  }

  static getStatus(): { status: CloudSyncStatus; statusMessage?: string } {
    return { status, statusMessage: statusMessage || undefined }
  }

  static setStatus(nextStatus: CloudSyncStatus, message = ''): void {
    status = nextStatus
    statusMessage = message
    if (import.meta.client) {
      const runtimeStore = useRuntimeStore()
      runtimeStore.isError = nextStatus === 'error'
    }
  }

  static async register(email: string, password: string): Promise<AuthResult> {
    return await request<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  static async login(email: string, password: string): Promise<AuthResult> {
    return await request<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  static async me(): Promise<AuthResult['user']> {
    return await request<AuthResult['user']>('/auth/me')
  }

  static async logout(): Promise<void> {
    try {
      if (this.check()) await request<boolean>('/auth/logout', { method: 'POST' })
    } finally {
      this.clearToken()
    }
  }

  static async fetchMeta(types: string[]): Promise<CloudSyncRow[]> {
    return await request<CloudSyncRow[]>(`/sync/meta?types=${encodeURIComponent(types.join(','))}`)
  }

  static async fetchData(types: string[]): Promise<CloudSyncRow[]> {
    return await request<CloudSyncRow[]>(`/sync/data?types=${encodeURIComponent(types.join(','))}`)
  }

  static async upsert(rows: CloudSyncRow[]): Promise<boolean> {
    return await request<boolean>('/sync/data', {
      method: 'PUT',
      body: JSON.stringify({ rows }),
    })
  }
}
