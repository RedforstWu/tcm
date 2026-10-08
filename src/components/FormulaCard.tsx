import { Link } from 'react-router-dom'
import type { Clause, Formula } from '@/types/data'
import { bookTitle } from '@/lib/data'
import { formatDualGrams } from '@/lib/dose-display'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'

interface FormulaCardProps {
  formula: Formula
  clauses: Clause[]
  highlightHerbId?: string
  compact?: boolean
}

export function FormulaCard({
  formula,
  clauses,
  highlightHerbId,
  compact = false,
}: FormulaCardProps) {
  const { scriptMode } = useAppContext()
  const sourceClauses = clauses.filter((clause) => formula.sourceClauseIds.includes(clause.id))

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <div>
        <p className="text-xs text-stone-500">{bookTitle(formula.book)}</p>
        <h3 className="font-serif text-xl font-bold">{convertScript(formula.name, scriptMode)}</h3>
        {formula.chapter && (
          <p className="mt-1 text-xs text-stone-500">{convertScript(formula.chapter, scriptMode)}</p>
        )}
      </div>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-stone-700">组成</h4>
        {formula.herbs.length === 0 ? (
          <p className="text-sm text-stone-500">此版原文未载完整药味，或待从他本回填。</p>
        ) : (
          <div className="space-y-1.5">
            {formula.herbs.map((herb) => {
              const highlighted = highlightHerbId === herb.herbId
              return (
                <div
                  key={`${herb.herbId}-${herb.doseRaw}`}
                  className={`rounded-xl px-3 py-2 text-sm ${
                    highlighted ? 'bg-cinnabar-soft ring-1 ring-cinnabar/30' : 'bg-paper-dark'
                  }`}
                >
                  <span className={`font-medium ${highlighted ? 'text-cinnabar' : ''}`}>
                    {convertScript(herb.name, scriptMode)}
                  </span>
                  <span className="ml-2 text-stone-500">{herb.doseRaw}</span>
                  {herb.processing && (
                    <span className="ml-2 text-xs text-stone-400">({herb.processing})</span>
                  )}
                  {formatDualGrams(herb.doseLiang) && (
                    <div className="mt-1 text-xs text-stone-400">
                      {formatDualGrams(herb.doseLiang)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {formula.preparation && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-stone-700">煎服法</h4>
          <p className="prose-classic text-sm leading-relaxed text-stone-700">
            {convertScript(formula.preparation, scriptMode)}
          </p>
        </section>
      )}

      {formula.modifications.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-stone-700">方后加减</h4>
          <ul className="space-y-2 text-sm">
            {formula.modifications.map((mod, index) => (
              <li key={index} className="rounded-xl bg-amber-soft/60 px-3 py-2">
                <span className="font-medium">若{mod.condition}</span>
                {mod.remove.length > 0 && <span>，去{mod.remove.join('、')}</span>}
                {mod.add.length > 0 && (
                  <span>，加{mod.add.map((item) => `${item.name}${item.doseRaw}`).join('、')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4 className="mb-2 text-sm font-semibold text-stone-700">出处条文</h4>
        <div className="space-y-2">
          {sourceClauses.map((clause) => (
            <Link
              key={clause.id}
              to={`/read/${clause.book}?clause=${clause.id}`}
              className="block rounded-xl bg-paper-dark p-3 text-sm hover:bg-stone-100"
            >
              <div className="mb-1 text-xs text-stone-400">
                {bookTitle(clause.book)} · {clause.order}
              </div>
              {convertScript(clause.text, scriptMode)}
            </Link>
          ))}
          {sourceClauses.length === 0 && (
            <p className="text-sm text-stone-500">暂无直接挂钩条文。</p>
          )}
        </div>
      </section>
    </div>
  )
}
