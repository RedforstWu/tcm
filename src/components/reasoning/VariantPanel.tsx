import { faArrowRight, faPills } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { isSingleHerbAddition } from '@/lib/formula-variants'
import type { Formula, FormulaDiffPair } from '@/types/data'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'

interface VariantPanelProps {
  formulaId: string | undefined
  formulaName: string
  diffPairs: FormulaDiffPair[]
  formulasById: Map<string, Formula>
  onSelectFormulaName: (name: string) => void
}

export function VariantPanel({
  formulaId,
  formulaName,
  diffPairs,
  formulasById,
  onSelectFormulaName,
}: VariantPanelProps) {
  const { scriptMode } = useAppContext()

  if (!formulaId) {
    return (
      <div className="rounded-xl border border-dashed border-stone-200 bg-white px-4 py-6 text-sm text-stone-400">
        「{convertScript(formulaName, scriptMode)}」未关联伤寒金匮方剂数据，暂无加减推演。
      </div>
    )
  }

  const outgoing = diffPairs
    .filter((pair) => pair.fromId === formulaId && isSingleHerbAddition(pair))
    .slice(0, 16)

  if (outgoing.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-200 bg-white px-4 py-6 text-sm text-stone-400">
        没有只加一味、不去药的加减方。
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="font-serif text-lg font-semibold">
        <FontAwesomeIcon icon={faPills} className="mr-2 text-cinnabar" />
        类方加减推演
      </h3>
      <p className="text-sm text-stone-500">
        从现有最小差异方对读取：新增症状 → 加某药 → 新方（点击可切换推理链）。
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {outgoing.map((pair) => {
          const toFormula = formulasById.get(pair.toId)
          const gained = pair.symptomDelta.gained.slice(0, 4)
          return (
            <li key={pair.id}>
              <button
                type="button"
                disabled={!toFormula}
                onClick={() => {
                  if (toFormula) onSelectFormulaName(toFormula.name)
                }}
                className="flex w-full items-start gap-3 rounded-xl border border-stone-200 bg-white px-3 py-3 text-left transition hover:border-teal/40 hover:bg-teal-soft/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-stone-400">新增症状</div>
                  <div className="text-sm text-stone-700">
                    {gained.length > 0
                      ? gained.map((item) => convertScript(item, scriptMode)).join('、')
                      : '（证候差未见标签）'}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full bg-cinnabar-soft px-2 py-0.5 text-cinnabar">
                      +{convertScript(pair.herbName, scriptMode)}
                    </span>
                    <FontAwesomeIcon icon={faArrowRight} className="text-stone-300" />
                    <span className="font-serif font-semibold text-teal">
                      {toFormula
                        ? convertScript(toFormula.name, scriptMode)
                        : pair.toId}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
