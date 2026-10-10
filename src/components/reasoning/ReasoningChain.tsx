import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { faBookOpen, faLink } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { FormulaReasoning } from '@/types/data'
import { bookTitle } from '@/lib/data'
import { reasoningCardVisibility } from '@/lib/reasoning-display'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'

interface ReasoningChainProps {
  formula: FormulaReasoning
}

const NATURE_COLORS: Record<string, string> = {
  热: 'bg-red-100 text-red-800',
  寒: 'bg-sky-100 text-sky-800',
  补: 'bg-amber-100 text-amber-900',
  泻: 'bg-violet-100 text-violet-800',
  升: 'bg-orange-100 text-orange-800',
  降: 'bg-indigo-100 text-indigo-800',
  收: 'bg-emerald-100 text-emerald-800',
  散: 'bg-rose-100 text-rose-800',
  润: 'bg-cyan-100 text-cyan-800',
  燥: 'bg-stone-200 text-stone-800',
}

export function ReasoningChain({ formula }: ReasoningChainProps) {
  const { scriptMode } = useAppContext()
  const [hoverSymptom, setHoverSymptom] = useState<string | null>(null)

  const visibility = reasoningCardVisibility(formula.reviewStatus)
  const highlightedHerbs = useMemo(() => {
    if (!hoverSymptom) return new Set<string>()
    const indication = formula.indications.find((item) => item.symptom === hoverSymptom)
    return new Set(indication?.herbNames ?? [])
  }, [hoverSymptom, formula.indications])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-400">推理链</p>
          <h3 className="font-serif text-xl font-bold text-cinnabar">
            {convertScript(formula.formulaName, scriptMode)}
          </h3>
          {visibility.showFunction ? (
            <p className="text-sm text-stone-600">{convertScript(formula.function, scriptMode)}</p>
          ) : (
            <p className="text-sm text-stone-500">{visibility.hiddenNote}</p>
          )}
        </div>
        {formula.formulaId && (
          <Link
            to={`/formulas/${encodeURIComponent(formula.formulaId)}`}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-teal hover:bg-teal-soft"
          >
            <FontAwesomeIcon icon={faLink} className="mr-1.5" />
            方剂详情
          </Link>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <section className="rounded-xl border border-stone-200 bg-white p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-700">
            <FontAwesomeIcon icon={faBookOpen} className="text-cinnabar" />
            原文条文
          </h4>
          <ul className="space-y-2 text-xs leading-relaxed text-stone-600">
            {formula.clauseRefs.length === 0 && (
              <li className="text-stone-400">讲义未列伤寒金匮条文（后世方）</li>
            )}
            {formula.clauseRefs.map((ref, index) => {
              const clauseId = formula.clauseIds[index]
              return (
                <li key={`${ref.book}-${ref.number}-${index}`} className="rounded-lg bg-paper-dark/60 p-2">
                  <div className="mb-1 text-[11px] text-stone-400">
                    {bookTitle(ref.book)} · 第{ref.number}条
                  </div>
                  <p className="prose-classic text-stone-700">
                    {convertScript(ref.excerpt, scriptMode)}
                  </p>
                  {clauseId && (
                    <Link
                      to={`/read/${ref.book}?clause=${encodeURIComponent(clauseId)}`}
                      className="mt-1 inline-block text-teal hover:underline"
                    >
                      阅读原文
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-3">
          <h4 className="mb-2 text-sm font-semibold text-stone-700">主症</h4>
          <ul className="space-y-1.5">
            {formula.indications.map((indication) => {
              const active = hoverSymptom === indication.symptom
              return (
                <li key={indication.symptom}>
                  <button
                    type="button"
                    onMouseEnter={() => setHoverSymptom(indication.symptom)}
                    onMouseLeave={() => setHoverSymptom(null)}
                    onFocus={() => setHoverSymptom(indication.symptom)}
                    onBlur={() => setHoverSymptom(null)}
                    onClick={() => setHoverSymptom(indication.symptom)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      active
                        ? 'bg-cinnabar text-white'
                        : 'bg-stone-50 text-stone-700 hover:bg-cinnabar-soft'
                    }`}
                  >
                    {convertScript(indication.symptom, scriptMode)}
                    {indication.rationale && (
                      <span
                        className={`mt-0.5 block text-[11px] ${active ? 'text-white/80' : 'text-stone-400'}`}
                      >
                        {convertScript(indication.rationale, scriptMode)}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        {visibility.showFunction && (
        <section className="rounded-xl border border-stone-200 bg-white p-3">
          <h4 className="mb-2 text-sm font-semibold text-stone-700">功能 / 病机</h4>
          <p className="rounded-lg bg-teal-soft/60 px-3 py-3 font-serif text-base text-teal">
            {convertScript(formula.function, scriptMode)}
          </p>
          <p className="mt-3 text-xs text-stone-500">
            悬停或点按主症，可高亮对应药物，观察「症 → 药」映射。
          </p>
        </section>
        )}

        <section className="rounded-xl border border-stone-200 bg-white p-3 lg:col-span-1">
          <h4 className="mb-2 text-sm font-semibold text-stone-700">单味药</h4>
          <ul className="space-y-2">
            {formula.herbs.map((herb) => {
              const active = highlightedHerbs.has(herb.name)
              return (
                <li
                  key={herb.name}
                  className={`rounded-lg border px-2.5 py-2 text-sm transition ${
                    active
                      ? 'border-cinnabar bg-cinnabar-soft shadow-sm'
                      : 'border-stone-100 bg-stone-50'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{convertScript(herb.name, scriptMode)}</span>
                    <span className="text-[11px] text-stone-400">权 {herb.weight}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">
                    {convertScript(herb.action, scriptMode)}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>

        {visibility.showNatures && (
        <section className="rounded-xl border border-stone-200 bg-white p-3">
          <h4 className="mb-2 text-sm font-semibold text-stone-700">药性标签</h4>
          <ul className="space-y-2">
            {formula.herbs.map((herb) => {
              const active = highlightedHerbs.has(herb.name)
              return (
                <li
                  key={herb.name}
                  className={`rounded-lg px-2 py-2 ${active ? 'bg-cinnabar-soft' : ''}`}
                >
                  <div className="mb-1 text-xs font-medium text-stone-600">
                    {convertScript(herb.name, scriptMode)}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {herb.natures.map((nature) => (
                      <span
                        key={nature}
                        className={`rounded-full px-2 py-0.5 text-[11px] ${NATURE_COLORS[nature] ?? 'bg-stone-100'}`}
                      >
                        {nature}
                      </span>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
        )}
      </div>
    </div>
  )
}
