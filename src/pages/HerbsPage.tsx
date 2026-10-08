import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Herb } from '@/types/data'
import { loadHerbs } from '@/lib/data'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'

export function HerbsPage() {
  const { scriptMode, corpusFilter } = useAppContext()
  const [herbs, setHerbs] = useState<Herb[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    void loadHerbs().then(setHerbs)
  }, [])

  const filtered = useMemo(
    () =>
      herbs.filter((herb) => {
        if (query && !herb.name.includes(query)) return false
        if (corpusFilter === 'all') return true
        const ids = herb.formulaIdsByCorpus?.[corpusFilter] ?? []
        return ids.length > 0 || (corpusFilter === 'chenfu' && Boolean(herb.monographId))
      }),
    [herbs, query, corpusFilter],
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">药物索引</h1>
        <p className="text-sm text-stone-500">点击进入药物页，查看最小差异对比与使用场景证据。</p>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索药名"
        className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm md:w-80"
      />
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filtered.map((herb) => (
          <Link
            key={herb.id}
            to={`/herbs/${encodeURIComponent(herb.id)}`}
            className="rounded-2xl border border-stone-200 bg-white/80 px-4 py-3 hover:border-cinnabar/40"
          >
            <div className="font-serif text-lg font-semibold">
              {convertScript(herb.name, scriptMode)}
            </div>
            <div className="text-xs text-stone-500">出现 {herb.frequency} 次 · {herb.formulaIds.length} 方</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
