import { faArrowLeft, faCheck, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { ReasoningTree, TreeResult } from '@/types/data'

export interface DecisionStep {
  nodeId: string
  optionLabel: string
}

interface DecisionStepperProps {
  tree: ReasoningTree
  path: DecisionStep[]
  onPathChange: (path: DecisionStep[]) => void
  onResult: (result: TreeResult | null) => void
}

export function DecisionStepper({ tree, path, onPathChange, onResult }: DecisionStepperProps) {
  const currentNodeId =
    path.length === 0 ? tree.rootNodeId : tree.nodes[path[path.length - 1]!.nodeId]
      ? (() => {
          const last = path[path.length - 1]!
          const lastNode = tree.nodes[last.nodeId]!
          const chosen = lastNode.options.find((option) => option.label === last.optionLabel)
          return chosen?.nextNodeId ?? null
        })()
      : null

  const currentNode = currentNodeId ? tree.nodes[currentNodeId] : null

  const jumpTo = (index: number) => {
    const nextPath = path.slice(0, index)
    onPathChange(nextPath)
    onResult(null)
  }

  const choose = (optionLabel: string) => {
    if (!currentNodeId || !currentNode) return
    const option = currentNode.options.find((item) => item.label === optionLabel)
    if (!option) return
    const nextPath = [...path, { nodeId: currentNodeId, optionLabel }]
    onPathChange(nextPath)
    if (option.result) {
      onResult(option.result)
    } else {
      onResult(null)
    }
  }

  const lastResult =
    path.length > 0
      ? (() => {
          const last = path[path.length - 1]!
          const node = tree.nodes[last.nodeId]
          return node?.options.find((option) => option.label === last.optionLabel)?.result ?? null
        })()
      : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 text-sm text-stone-500">
        <button
          type="button"
          className="rounded-md px-2 py-1 hover:bg-stone-100"
          onClick={() => jumpTo(0)}
        >
          {tree.title}
        </button>
        {path.map((step, index) => (
          <span key={`${step.nodeId}-${index}`} className="inline-flex items-center gap-1">
            <FontAwesomeIcon icon={faChevronRight} className="text-xs text-stone-300" />
            <button
              type="button"
              className="max-w-[12rem] truncate rounded-md px-2 py-1 hover:bg-stone-100"
              onClick={() => jumpTo(index + 1)}
              title={step.optionLabel}
            >
              {step.optionLabel}
            </button>
          </span>
        ))}
      </div>

      {path.length > 0 && (
        <button
          type="button"
          className="text-sm text-teal hover:underline"
          onClick={() => jumpTo(path.length - 1)}
        >
          <FontAwesomeIcon icon={faArrowLeft} className="mr-1.5" />
          回退一步
        </button>
      )}

      {currentNode && (
        <div>
          <h3 className="mb-3 font-serif text-lg font-semibold text-stone-800">
            {currentNode.question}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {currentNode.options.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => choose(option.label)}
                className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm transition hover:border-cinnabar/40 hover:bg-cinnabar-soft/40"
              >
                {option.label}
                {option.result && (
                  <span className="mt-1 block text-xs text-cinnabar">
                    → {option.result.formulaName}
                    {option.result.addHerbs?.length
                      ? ` + ${option.result.addHerbs.join('、')}`
                      : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {lastResult && !currentNode && (
        <div className="rounded-xl border border-teal/30 bg-teal-soft/50 px-4 py-4">
          <p className="text-sm text-teal">
            <FontAwesomeIcon icon={faCheck} className="mr-2" />
            方证收敛
          </p>
          <p className="mt-1 font-serif text-xl font-bold text-stone-900">
            {lastResult.formulaName}
            {lastResult.addHerbs?.length ? (
              <span className="ml-2 text-base font-medium text-stone-600">
                + {lastResult.addHerbs.join('、')}
              </span>
            ) : null}
          </p>
          {lastResult.note && <p className="mt-1 text-sm text-stone-600">{lastResult.note}</p>}
        </div>
      )}
    </div>
  )
}
