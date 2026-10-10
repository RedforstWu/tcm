import { bookTitle } from '@/lib/data'
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

const SECTION_INDEX = /[零一二三四五六七八九十百千]{2,}$/u

export function classicSearchRank(book?: string): number {
  if (book === 'songben') return 0
  if (book === 'jingui') return 1
  return 2
}

export function orderSearchResults<T extends { book?: string; score: number }>(results: T[]): T[] {
  return [...results].sort((left, right) => {
    const rank = classicSearchRank(left.book) - classicSearchRank(right.book)
    if (rank !== 0) return rank
    return right.score - left.score
  })
}

function readableHeading(heading: string): string {
  const withoutOrder = heading.replace(/·\d+$/, '')
  const withoutIndex = withoutOrder.replace(SECTION_INDEX, '')
  return withoutIndex || withoutOrder
}

export function presentSearchResult(doc: Pick<SearchDoc, 'type' | 'book' | 'title'>): {
  typeLabel: string
  bookLabel: string | null
  title: string
} {
  const bookLabel = doc.book ? bookTitle(doc.book as BookId) : null
  let title = doc.title
  if (doc.book && bookLabel && title.startsWith(`${doc.book}·`)) {
    title = `${bookLabel} · ${readableHeading(title.slice(doc.book.length + 1))}`
  }
  return {
    typeLabel: TYPE_LABEL[doc.type],
    bookLabel,
    title,
  }
}
