import { CLOUD_TOKEN_KEY } from '../utils/cloudSync.ts'
import type {
  LibraryAdminBook, LibraryAdminBookSummary, LibraryBookContent, LibraryBookSummary,
  LibraryFeedback, LibraryFeedbackKind, LibraryFeedbackStatus, LibraryPage,
  LibraryRelease, LibraryReleaseSummary, LibraryValidation,
} from '../types/library.ts'

export class LibraryApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function libraryRequest<T>(path: string, options: RequestInit = {}, authenticated = false): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('Content-Type', 'application/json')
  if (authenticated && import.meta.client) {
    const token = localStorage.getItem(CLOUD_TOKEN_KEY)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await fetch(`/api${path}`, { ...options, headers, signal: options.signal ?? controller.signal })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.success) {
      throw new LibraryApiError(body?.msg || `词书服务请求失败（${response.status}）`, response.status)
    }
    return body.data as T
  } finally {
    clearTimeout(timeout)
  }
}

const bookPath = (id: string) => `/admin/library/books/${encodeURIComponent(id)}`
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const LibraryApi = {
  catalog: () => libraryRequest<LibraryBookSummary[]>('/library/books'),
  release: (id: string, version?: number) => libraryRequest<LibraryRelease>(`/library/books/${encodeURIComponent(id)}${version ? `?version=${version}` : ''}`),
  adminBooks: () => libraryRequest<LibraryAdminBookSummary[]>('/admin/library/books', {}, true),
  create: (content: LibraryBookContent) => libraryRequest<LibraryAdminBook>('/admin/library/books', json('POST', { content }), true),
  adminBook: (id: string) => libraryRequest<LibraryAdminBook>(bookPath(id), {}, true),
  saveDraft: (id: string, expectedRevision: number, content: LibraryBookContent) => libraryRequest<LibraryAdminBook>(`${bookPath(id)}/draft`, json('PUT', { expectedRevision, content }), true),
  validate: (id: string, content?: LibraryBookContent) => libraryRequest<LibraryValidation>(`${bookPath(id)}/validate`, json('POST', content ? { content } : {}), true),
  publish: (id: string, expectedRevision: number, note: string) => libraryRequest<LibraryRelease>(`${bookPath(id)}/publish`, json('POST', { expectedRevision, note }), true),
  releases: (id: string) => libraryRequest<LibraryReleaseSummary[]>(`${bookPath(id)}/releases`, {}, true),
  historicalRelease: (id: string, version: number) => libraryRequest<LibraryRelease>(`${bookPath(id)}/releases/${version}`, {}, true),
  rollback: (id: string, expectedRevision: number, version: number, note: string) => libraryRequest<LibraryRelease>(`${bookPath(id)}/rollback`, json('POST', { expectedRevision, version, note }), true),
  submitFeedback: (id: string, feedback: { version: number; word?: string; kind: LibraryFeedbackKind; message: string }) => libraryRequest<LibraryFeedback>(`/library/books/${encodeURIComponent(id)}/feedback`, json('POST', feedback), true),
  myFeedback: (offset = 0) => libraryRequest<LibraryPage<LibraryFeedback>>(`/library/feedback?limit=50&offset=${offset}`, {}, true),
  feedback: (query: { status?: string; bookId?: string; offset?: number } = {}) => {
    const params = new URLSearchParams({ limit: '50', offset: String(query.offset ?? 0) })
    if (query.status) params.set('status', query.status)
    if (query.bookId) params.set('bookId', query.bookId)
    return libraryRequest<LibraryPage<LibraryFeedback>>(`/admin/library/feedback?${params}`, {}, true)
  },
  updateFeedback: (id: number, status: LibraryFeedbackStatus, reply: string) => libraryRequest<LibraryFeedback>(`/admin/library/feedback/${id}`, json('PATCH', { status, reply }), true),
}
