import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Formula, Herb } from '@/types/data'
import { BOOK_CORPUS } from '@/types/data'
import { loadFormulas, loadHerbs, bookTitle } from '@/lib/data'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'

export function FormulasPage() {
  const { scriptMode, corpusFilter } = useAppContext()
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [herbs, setHerbs] = useState<Herb[]>([])
  const [query, setQuery] = useState('')
  const [herbFilter, setHerbFilter] = useState('')
  const [bookFilter, setBookFilter] = useState<'all' | Formula['book']>('all')

  useEffect(() => {
    void Promise.all([loadFormulas(), loadHerbs()]).then(([formulaList, herbList]) => {
      setFormulas(formulaList)
      setHerbs(herbList)
    })
  }, [])

  const filtered = useMemo(() => {
    return formulas.filter((formula) => {
      if (corpusFilter !== 'all' && BOOK_CORPUS[formula.book] !== corpusFilter) return false
      if (bookFilter !== 'all' && formula.book !== bookFilter) return false
      if (herbFilter && !formula.herbs.some((herb) => herb.herbId === herbFilter)) return false
      if (!query) return true
      const hay = `${formula.name} ${formula.herbs.map((herb) => herb.name).join(' ')}`
      return hay.includes(query)
    })
  }, [formulas, query, herbFilter, bookFilter, corpusFilter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold">方剂库</h1>
          <p className="text-sm text-stone-500">共 {filtered.length} 方</p>
        </div>
        <Link to="/formulas/family" className="rounded-lg bg-teal px-4 py-2 text-sm text-white">
          方剂家族图
        </Link>
      </div>

      <div className="grid gap-3 rounded-2xl border border-stone-200 bg-white/80 p-4 md:grid-cols-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索方名 / 药物"
          className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
        />
        <select
          value={bookFilter}
          onChange={(event) => setBookFilter(event.target.value as typeof bookFilter)}
          className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
        >
          <option value="all">全部书籍</option>
          <option value="songben">宋本伤寒论</option>
          <option value="jingui">金匮要略</option>
          <option value="guilin">桂林古本</option>
          <option value="funvke">傅青主女科</option>
          <option value="funanke">傅青主男科</option>
          <option value="bianzheng">辨证录</option>
          <option value="shishi">石室秘录</option>
        </select>
        <select
          value={herbFilter}
          onChange={(event) => setHerbFilter(event.target.value)}
          className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
        >
          <option value="">全部药物</option>
          {herbs.slice(0, 80).map((herb) => (
            <option key={herb.id} value={herb.id}>
              {herb.name}（{herb.frequency}）
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.slice(0, 200).map((formula) => (
          <Link
            key={formula.id}
            to={`/formulas/${encodeURIComponent(formula.id)}`}
            className="rounded-2xl border border-stone-200 bg-white/80 p-4 transition hover:border-cinnabar/40"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="font-serif text-lg font-semibold">
                {convertScript(formula.name, scriptMode)}
              </h2>
              <span className="text-xs text-stone-400">{bookTitle(formula.book)}</span>
            </div>
            <p className="text-sm text-stone-600">
              {formula.herbs.length > 0
                ? convertScript(formula.herbs.map((herb) => herb.name).join('、'), scriptMode)
                : '组成待补'}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
