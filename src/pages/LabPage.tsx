import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Formula, Herb } from '@/types/data'
import { loadFormulas, loadHerbs } from '@/lib/data'
import { doseAwareScore, type MatchHerb } from '@/lib/formula-match'

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const item of a) if (b.has(item)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

export function LabPage() {
  const [herbs, setHerbs] = useState<Herb[]>([])
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [baseId, setBaseId] = useState('')
  const [addHerb, setAddHerb] = useState('')
  const [removeHerb, setRemoveHerb] = useState('')

  useEffect(() => {
    void Promise.all([loadHerbs(), loadFormulas()]).then(([herbList, formulaList]) => {
      setHerbs(herbList.slice(0, 60))
      const songben = formulaList.filter((item) => item.book === 'songben' && item.herbs.length > 0)
      setFormulas(songben)
      setBaseId(songben.find((item) => item.name === '桂枝汤')?.id ?? songben[0]?.id ?? '')
    })
  }, [])

  const matches = useMemo(() => {
    if (selected.size === 0) return []
    return formulas
      .map((formula) => {
        const set = new Set(formula.herbs.map((herb) => herb.herbId))
        return {
          formula,
          score: jaccard(selected, set),
          missing: [...set].filter((id) => !selected.has(id)),
          extra: [...selected].filter((id) => !set.has(id)),
        }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [selected, formulas])

  const deduction = useMemo(() => {
    const base = formulas.find((item) => item.id === baseId)
    if (!base) return null
    const nextHerbs: MatchHerb[] = base.herbs
      .filter((herb) => herb.herbId !== removeHerb)
      .map((herb) => ({
        herbId: herb.herbId,
        name: herb.name,
        doseLiang: herb.doseLiang,
        doseCount: herb.doseCount,
        doseRaw: herb.doseRaw,
      }))
    if (addHerb) {
      const added = herbs.find((herb) => herb.id === addHerb)
      nextHerbs.push({ herbId: addHerb, name: added?.name ?? addHerb })
    }
    const ranked = formulas
      .filter((item) => item.id !== base.id)
      .map((formula) => {
        const matched = doseAwareScore(
          nextHerbs,
          formula.herbs.map((herb) => ({
            herbId: herb.herbId,
            name: herb.name,
            doseLiang: herb.doseLiang,
            doseCount: herb.doseCount,
            doseRaw: herb.doseRaw,
          })),
        )
        return { formula, score: matched.score, doseNotes: matched.doseNotes }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
    return { base, ranked }
  }, [formulas, herbs, baseId, addHerb, removeHerb])

  function toggle(herbId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(herbId)) next.delete(herbId)
      else next.add(herbId)
      return next
    })
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="font-serif text-2xl font-bold">组方实验室</h1>
        <p className="text-sm text-stone-500">勾选药物，匹配最接近的经方并显示差异。</p>
        <div className="flex flex-wrap gap-2">
          {herbs.map((herb) => (
            <button
              key={herb.id}
              type="button"
              onClick={() => toggle(herb.id)}
              className={`rounded-full px-3 py-1 text-sm ${
                selected.has(herb.id) ? 'bg-cinnabar text-white' : 'bg-white ring-1 ring-stone-200'
              }`}
            >
              {herb.name}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {matches.map((item) => (
            <div key={item.formula.id} className="rounded-xl border border-stone-200 bg-white p-3 text-sm">
              <Link className="font-medium text-cinnabar" to={`/formulas/${encodeURIComponent(item.formula.id)}`}>
                {item.formula.name}
              </Link>
              <span className="ml-2 text-stone-500">相似度 {(item.score * 100).toFixed(0)}%</span>
              <div className="mt-1 text-xs text-stone-500">
                缺少：{item.missing.map((id) => herbs.find((herb) => herb.id === id)?.name ?? id).join('、') || '无'}
                ；多选：{item.extra.map((id) => herbs.find((herb) => herb.id === id)?.name ?? id).join('、') || '无'}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-stone-200 bg-white/80 p-5">
        <h2 className="font-serif text-xl font-semibold">加减推演</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            value={baseId}
            onChange={(event) => setBaseId(event.target.value)}
            className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
          >
            {formulas.map((formula) => (
              <option key={formula.id} value={formula.id}>
                {formula.name}
              </option>
            ))}
          </select>
          <select
            value={addHerb}
            onChange={(event) => setAddHerb(event.target.value)}
            className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
          >
            <option value="">加味（可选）</option>
            {herbs.map((herb) => (
              <option key={herb.id} value={herb.id}>
                加 {herb.name}
              </option>
            ))}
          </select>
          <select
            value={removeHerb}
            onChange={(event) => setRemoveHerb(event.target.value)}
            className="rounded-xl border border-stone-200 px-3 py-2 text-sm"
          >
            <option value="">减味（可选）</option>
            {(deduction?.base.herbs ?? []).map((herb) => (
              <option key={herb.herbId} value={herb.herbId}>
                去 {herb.name}
              </option>
            ))}
          </select>
        </div>
        {deduction && (
          <div className="space-y-2">
            <p className="text-sm text-stone-600">
              以「{deduction.base.name}」为底，推演后最接近：
            </p>
            {deduction.ranked.map((item) => (
              <Link
                key={item.formula.id}
                to={`/formulas/${encodeURIComponent(item.formula.id)}`}
                className="block rounded-xl bg-paper-dark px-3 py-2 text-sm hover:bg-teal-soft"
              >
                {item.formula.name}
                <span className="ml-2 text-stone-500">{(item.score * 100).toFixed(0)}%</span>
                {item.doseNotes.length > 0 && (
                  <span className="mt-1 block text-xs text-stone-500">{item.doseNotes.join('；')}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
