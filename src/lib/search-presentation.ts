import { bookShortName } from '@/lib/data'
import type { BookId, SearchDoc } from '@/types/data'

const TYPE_LABEL: Record<SearchDoc['type'], string> = {
  clause: '条文',
  formula: '方剂',
  herb: '药物',
  fangjie: '方解',
  monograph: '本草',
}

export function searchQueryFromParams(params: URLSearchParams): string {
  return params.get('q') ?? ''
}

export function applySearchQuery(params: URLSearchParams, query: string): URLSearchParams {
  const next = new URLSearchParams(params)
  if (query.trim()) next.set('q', query)
  else next.delete('q')
  return next
}

export function presentSearchResult(doc: Pick<SearchDoc, 'type' | 'book' | 'title'>): {
  typeLabel: string
  bookLabel: string | null
  title: string
} {
  const bookLabel = doc.book ? bookShortName(doc.book) : null
  let title = doc.title
  if (doc.book && title.startsWith(`${doc.book}·`)) {
    title = `${bookShortName(doc.book as BookId)}·${title.slice(doc.book.length + 1)}`
  }
  return {
    typeLabel: TYPE_LABEL[doc.type],
    bookLabel,
    title,
  }
}
