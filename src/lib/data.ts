import type {
  AlignmentRecord,
  BookId,
  ChenfuReasoningDataset,
  Clause,
  Corpus,
  CrossLink,
  DatasetIndex,
  Formula,
  FormulaDiffPair,
  FormulaFamily,
  Herb,
  HerbMonograph,
  HerbRole,
  ParallelAlignment,
  ReasoningDataset,
  SearchDoc,
} from '@/types/data'
import { BOOK_BY_ID, BOOK_CORPUS, CLAUSE_BOOKS } from '@/types/data'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return response.json() as Promise<T>
}

let cache: {
  index?: DatasetIndex
  formulas?: Formula[]
  herbs?: Herb[]
  diffPairs?: FormulaDiffPair[]
  families?: FormulaFamily[]
  searchDocs?: SearchDoc[]
  alignments?: { alignments: AlignmentRecord[]; uniqueGuilinIds: string[] }
  parallels?: { nvkeAlign: ParallelAlignment[]; nankeAlign: ParallelAlignment[] }
  herbRoles?: HerbRole[]
  monographs?: HerbMonograph[]
  crossLinks?: CrossLink[]
  reasoning?: ReasoningDataset
  chenfuReasoning?: ChenfuReasoningDataset
  clauses: Partial<Record<BookId, Clause[]>>
} = { clauses: {} }

export async function loadIndex(): Promise<DatasetIndex> {
  cache.index ??= await fetchJson<DatasetIndex>('/data/index.json')
  return cache.index
}

export async function loadClauses(book: BookId): Promise<Clause[]> {
  if (!BOOK_BY_ID[book]?.hasClauses) return []
  if (!cache.clauses[book]) {
    cache.clauses[book] = await fetchJson<Clause[]>(`/data/clauses-${book}.json`)
  }
  return cache.clauses[book]!
}

export async function loadAllClauses(corpus?: Corpus | 'all'): Promise<Clause[]> {
  const books =
    !corpus || corpus === 'all'
      ? CLAUSE_BOOKS
      : Object.entries(BOOK_CORPUS)
          .filter(([id, value]) => value === corpus && BOOK_BY_ID[id as BookId]?.hasClauses)
          .map(([id]) => id as BookId)
  const lists = await Promise.all(books.map((book) => loadClauses(book)))
  return lists.flat()
}

export async function loadFormulas(): Promise<Formula[]> {
  cache.formulas ??= await fetchJson<Formula[]>('/data/formulas.json')
  return cache.formulas
}

export async function loadHerbs(): Promise<Herb[]> {
  cache.herbs ??= await fetchJson<Herb[]>('/data/herbs.json')
  return cache.herbs
}

export async function loadDiffPairs(): Promise<FormulaDiffPair[]> {
  cache.diffPairs ??= await fetchJson<FormulaDiffPair[]>('/data/diff-pairs.json')
  return cache.diffPairs
}

export async function loadFamilies(): Promise<FormulaFamily[]> {
  cache.families ??= await fetchJson<FormulaFamily[]>('/data/families.json')
  return cache.families
}

export async function loadSearchDocs(): Promise<SearchDoc[]> {
  cache.searchDocs ??= await fetchJson<SearchDoc[]>('/data/search-docs.json')
  return cache.searchDocs
}

export async function loadAlignments() {
  cache.alignments ??= await fetchJson('/data/alignments.json')
  return cache.alignments
}

export async function loadParallels() {
  cache.parallels ??= await fetchJson('/data/parallels.json')
  return cache.parallels
}

export async function loadHerbRoles(): Promise<HerbRole[]> {
  cache.herbRoles ??= await fetchJson<HerbRole[]>('/data/herb-roles.json')
  return cache.herbRoles
}

export async function loadMonographs(): Promise<HerbMonograph[]> {
  cache.monographs ??= await fetchJson<HerbMonograph[]>('/data/herb-monographs.json')
  return cache.monographs
}

export async function loadCrossLinks(): Promise<CrossLink[]> {
  cache.crossLinks ??= await fetchJson<CrossLink[]>('/data/cross-links.json')
  return cache.crossLinks
}

export async function loadReasoning(): Promise<ReasoningDataset> {
  cache.reasoning ??= await fetchJson<ReasoningDataset>('/data/reasoning.json')
  return cache.reasoning
}

export async function loadChenfuReasoning(): Promise<ChenfuReasoningDataset> {
  cache.chenfuReasoning ??= await fetchJson<ChenfuReasoningDataset>('/data/reasoning-chenfu.json')
  return cache.chenfuReasoning
}

export function bookTitle(book: BookId): string {
  return BOOK_BY_ID[book]?.title ?? book
}

export function bookShortName(book: BookId): string {
  return BOOK_BY_ID[book]?.shortName ?? book
}

export function bookColor(book: BookId): string {
  return BOOK_BY_ID[book]?.color ?? '#78716c'
}

export function corpusOf(book: BookId): Corpus {
  return BOOK_CORPUS[book]
}

export function filterByCorpus<T extends { book?: BookId }>(
  items: T[],
  corpus: Corpus | 'all',
): T[] {
  if (corpus === 'all') return items
  return items.filter((item) => !item.book || BOOK_CORPUS[item.book] === corpus)
}
