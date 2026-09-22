import { useRuntimeStore } from '../stores'
import { observeServerClock } from './historyPolicy'

export const CLOUD_TOKEN_KEY = 'typewords_cloud_token'

export type CloudSyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'pending' | 'conflict'

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

export type AuthResult = {
  token: string
  user: {
    id: number
    email: string
    is_admin?: boolean
  }
}

let status: CloudSyncStatus = 'idle'
let statusMessage = ''

export class CloudSyncError extends Error {
  constructor(message: string, public statusCode: number) { super(message) }
}

function getToken(): string {
  if (!import.meta.client) return ''
  return localStorage.getItem(CLOUD_TOKEN_KEY) ?? ''
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('X-TypeWords-Data-Format', '3')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(15000),
  })
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null
  observeServerClock(response.headers.get('Date'))
  if (!response.ok || !body?.success) {
    if (response.status === 428 && import.meta.client) window.dispatchEvent(new Event('typewords-update-required'))
    if (response.status === 401 && import.meta.client && getToken() === token) {
      localStorage.removeItem(CLOUD_TOKEN_KEY)
    }
    throw new CloudSyncError(body?.msg || `Request failed (${response.status})`, response.status)
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
      window.dispatchEvent(new Event('typewords-sync-status'))
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


  static snapshot() { return request<import('./syncPolicy').SafeSnapshot>('/sync/snapshot') }
  static putSnapshot(payload: { expectedRevision: number; requestId: string; rows: import('./syncPolicy').SafeRow[]; reason?: string }) {
    return request<{ revision: number }>('/sync/snapshot', { method: 'PUT', body: JSON.stringify(payload) })
  }
  static history() { return request<Array<{ id: string; revision: number; kind: string; day: string; createdAt: string; deletedAt: string; summary: { books?: Array<{ name: string; learned: number }>; unfinished?: number } }>>('/sync/history') }
  static historySnapshot(id: string) { return request<import('./syncPolicy').SafeSnapshot>(`/sync/history/${encodeURIComponent(id)}`) }
  static deleteHistory(id: string) { return request<boolean>(`/sync/history/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  static undoHistoryDelete(id: string) { return request<boolean>(`/sync/history/${encodeURIComponent(id)}/undo`, { method: 'POST' }) }
  static receipt(id: string) { return request<{ revision: number } | null>(`/sync/receipts/${encodeURIComponent(id)}`) }
  static backupStatus() { return request<{ enabled: boolean; server: { file: string; createdAt: string } | null; mac: { file: string; verifiedAt: string } | null }>('/admin/sync/backup-status') }
}
