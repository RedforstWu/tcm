import MiniSearch from 'minisearch'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SearchDoc } from '@/types/data'
import { loadSearchDocs } from '@/lib/data'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'

export function SearchPage() {
  const { scriptMode } = useAppContext()
  const [docs, setDocs] = useState<SearchDoc[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    void loadSearchDocs().then(setDocs)
  }, [])

  const engine = useMemo(() => {
    const mini = new MiniSearch<SearchDoc>({
      fields: ['title', 'text'],
      storeFields: ['title', 'text', 'type', 'href', 'book'],
      searchOptions: { prefix: true, fuzzy: 0.1 },
    })
    if (docs.length > 0) mini.addAll(docs)
    return mini
  }, [docs])

  const results = useMemo(() => {
    if (!query.trim()) return []
    return engine.search(query).slice(0, 40)
  }, [engine, query])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">全文搜索</h1>
        <p className="text-sm text-stone-500">检索条文、方名、药名。</p>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="例如：桂枝去芍药、心下痞、附子"
        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base shadow-sm"
        autoFocus
      />
      <div className="space-y-2">
        {results.map((result) => (
          <Link
            key={result.id}
            to={String(result.href)}
            className="block rounded-2xl border border-stone-200 bg-white/80 p-4 hover:border-cinnabar/40"
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-stone-400">
              <span className="rounded bg-stone-100 px-2 py-0.5">{result.type}</span>
              {result.book && <span>{result.book}</span>}
            </div>
            <h2 className="font-serif text-lg font-semibold">
              {convertScript(String(result.title), scriptMode)}
            </h2>
            <p className="mt-1 line-clamp-2 text-sm text-stone-600">
              {convertScript(String(result.text).slice(0, 120), scriptMode)}
            </p>
          </Link>
        ))}
        {query && results.length === 0 && (
          <p className="text-sm text-stone-500">无结果，试试更短的关键词。</p>
        )}
      </div>
    </div>
  )
}
