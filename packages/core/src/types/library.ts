import type { BookUnit, Word } from './types.ts'

export interface LibraryBookContent {
  name: string
  description: string
  language: string
  translateLanguage: string
  category: string
  tags: string[]
  recommended: boolean
  sortOrder: number
  cover?: string
  words: Partial<Word>[]
  units: BookUnit[]
}

export interface LibraryBookSummary {
  id: string
  name: string
  description: string
  language: string
  translateLanguage: string
  category: string
  tags: string[]
  length: number
  version: number
  updatedAt: string
  recommended: boolean
  sortOrder: number
  cover?: string
}

export interface LibraryRelease {
  id: string
  version: number
  content: LibraryBookContent
  updatedAt: string
  note?: string
}

export interface LibraryAdminBookSummary {
  id: string
  name: string
  draftRevision: number
  publishedVersion: number
  updatedAt: string
  length: number
  unitsCount: number
  recommended: boolean
  sortOrder: number
  hasUnpublishedChanges: boolean
}

export interface LibraryAdminBook extends LibraryAdminBookSummary {
  draft: LibraryBookContent
  createdAt?: string
}

export interface LibraryReleaseSummary {
  version: number
  updatedAt: string
  note: string
  createdBy?: number
}

export interface LibraryIssue { path: string; message: string }
export interface LibraryValidation {
  valid: boolean
  errors: LibraryIssue[]
  warnings: LibraryIssue[]
}

export type LibraryFeedbackKind = 'content' | 'translation' | 'phonetic' | 'sentence' | 'unit' | 'other'
export type LibraryFeedbackStatus = 'open' | 'resolved' | 'dismissed'
export interface LibraryFeedback {
  id: number
  bookId: string
  bookName?: string
  version: number
  word?: string
  kind: LibraryFeedbackKind
  message: string
  status: LibraryFeedbackStatus
  reply?: string
  createdAt: string
  updatedAt: string
  userId?: number
}
export interface LibraryPage<T> { items: T[]; total: number; limit: number; offset: number }
