import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { faCodeBranch, faLink, faScaleUnbalanced } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { ChenfuChain } from '@/components/reasoning/ChenfuChain'
import { TreeOverview } from '@/components/reasoning/TreeOverview'
import { CHENFU_BOOK_LABELS, caseTitle } from '@/lib/chenfu'
import { reasoningCardVisibility } from '@/lib/reasoning-display'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import type {
  ChenfuCase,
  ChenfuReasoningDataset,
  ChenfuRecord,
  CompareFormulaRef,
  FormulaReasoning,
  ReasoningDataset,
} from '@/types/data'

interface CompareViewProps {
  chenfu: ChenfuReasoningDataset
  reasoning: ReasoningDataset
  topicId: string | null
  onTopicChange: (topicId: string) => void
}

interface CaseEntry {
  record: ChenfuRecord
  caseItem: ChenfuCase
}

function findFormulaReasoning(
  formulas: FormulaReasoning[],
  ref: CompareFormulaRef,
): FormulaReasoning | undefined {
  if (!ref.hasReasoning) return undefined
  return (
    formulas.find((item) => ref.formulaId !== undefined && item.formulaId === ref.formulaId) ??
    formulas.find((item) => item.formulaName === ref.name)
  )
}

function CompactFormulaCard({ formulaRef, card }: { formulaRef: CompareFormulaRef; card?: FormulaReasoning }) {
  const { scriptMode } = useAppContext()
  const visibility = card ? reasoningCardVisibility(card.reviewStatus) : null
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-serif font-semibold text-cinnabar">{convertScript(formulaRef.name, scriptMode)}</span>
        <span className="flex shrink-0 gap-2 text-xs">
          {card && (
            <Link
              to={`/reasoning?mode=jingfang&formula=${encodeURIComponent(card.formulaName)}`}
              className="text-teal hover:underline"
            >
              推理链
            </Link>
          )}
          {formulaRef.formulaId && (
            <Link to={`/formulas/${encodeURIComponent(formulaRef.formulaId)}`} className="text-teal hover:underline">
              <FontAwesomeIcon icon={faLink} className="mr-0.5" />
              方剂页
            </Link>
          )}
        </span>
      </div>
      {card ? (
        <>
          <p className="mt-1 text-xs text-stone-600">
            {visibility?.showFunction
              ? convertScript(card.function, scriptMode)
              : visibility?.hiddenNote}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {card.indications.map((indication) => (
              <span key={indication.symptom} className="rounded-full bg-cinnabar-soft px-2 py-0.5 text-[11px] text-cinnabar">
                {convertScript(indication.symptom, scriptMode)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-stone-500">
            {card.herbs.map((herb) => convertScript(herb.name, scriptMode)).join('、')}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-stone-400">讲义十二经方之外，仅链接方剂页查看条文与组成</p>
      )}
    </li>
  )
}

export function CompareView({ chenfu, reasoning, topicId, onTopicChange }: CompareViewProps) {
  const { scriptMode } = useAppContext()
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)

  const topic = chenfu.compareTopics.find((item) => item.id === topicId) ?? chenfu.compareTopics[0]

  const caseIndex = useMemo(() => {
    const map = new Map<string, CaseEntry>()
    for (const record of chenfu.records) {
      for (const caseItem of record.cases) map.set(caseItem.caseId, { record, caseItem })
    }
    return map
  }, [chenfu.records])

  const topicCases = useMemo(
    () =>
      (topic?.chenfuCaseIds ?? [])
        .map((caseId) => caseIndex.get(caseId))
        .filter((entry): entry is CaseEntry => Boolean(entry)),
    [topic, caseIndex],
  )

  if (!topic) {
    return <p className="text-sm text-stone-500">暂无对照专题。</p>
  }

  const tree = topic.jingfang.treeId
    ? reasoning.trees.find((item) => item.id === topic.jingfang.treeId)
    : undefined
  const activeCase =
    topicCases.find((entry) => entry.caseItem.caseId === selectedCaseId) ?? topicCases[0]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {chenfu.compareTopics.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setSelectedCaseId(null)
              onTopicChange(item.id)
            }}
            className={`rounded-xl px-3 py-2 text-sm ${
              item.id === topic.id ? 'bg-cinnabar text-white' : 'bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-cinnabar-soft'
            }`}
          >
            {convertScript(item.title, scriptMode)}
            <span className={`ml-1 text-[11px] ${item.id === topic.id ? 'text-white/70' : 'text-stone-400'}`}>
              {item.chenfuCaseIds.length}
            </span>
          </button>
        ))}
      </div>

      {topic.description && (
        <p className="flex items-start gap-2 rounded-xl bg-white/80 px-4 py-3 text-sm text-stone-600 ring-1 ring-stone-200">
          <FontAwesomeIcon icon={faScaleUnbalanced} className="mt-0.5 text-teal" />
          {convertScript(topic.description, scriptMode)}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="min-w-0 space-y-3">
          <h2 className="font-serif text-lg font-semibold">
            经方 · 方证对应
          </h2>
          <p className="text-xs text-stone-500">以「主症群 → 方」直接对应，药随证加减。</p>
          <ul className="space-y-2">
            {topic.jingfang.formulas.map((formulaRef) => (
              <CompactFormulaCard
                key={formulaRef.name}
                formulaRef={formulaRef}
                card={findFormulaReasoning(reasoning.formulas, formulaRef)}
              />
            ))}
          </ul>
          {tree && (
            <details className="rounded-xl border border-stone-200 bg-white p-3">
              <summary className="cursor-pointer text-sm font-medium text-stone-700">
                <FontAwesomeIcon icon={faCodeBranch} className="mr-1.5 text-cinnabar" />
                决策树：{convertScript(tree.title, scriptMode)}
              </summary>
              <div className="mt-2">
                <TreeOverview tree={tree} path={[]} />
              </div>
            </details>
          )}
        </section>

        <section className="min-w-0 space-y-3">
          <h2 className="font-serif text-lg font-semibold">
            陈傅 · 脏腑病机
          </h2>
          <p className="text-xs text-stone-500">先辨误判、再立病机与生克，然后定治法与方。</p>
          {topicCases.length === 0 ? (
            <p className="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-6 text-sm text-stone-500">
              本专题的陈傅病案尚待标注。
            </p>
          ) : (
            <>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {topicCases.map((entry) => {
                  const active = entry.caseItem.caseId === activeCase?.caseItem.caseId
                  return (
                    <button
                      key={entry.caseItem.caseId}
                      type="button"
                      onClick={() => setSelectedCaseId(entry.caseItem.caseId)}
                      className={`rounded-lg px-2 py-1 text-left text-[11px] ${
                        active ? 'bg-teal text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-teal-soft'
                      }`}
                    >
                      <span className="opacity-70">{CHENFU_BOOK_LABELS[entry.record.book]}｜</span>
                      {convertScript(caseTitle(entry.caseItem, entry.record, 16), scriptMode)}
                    </button>
                  )
                })}
              </div>
              {activeCase && (
                <div className="rounded-2xl border border-stone-200 bg-white/90 p-3 shadow-sm">
                  <ChenfuChain
                    key={activeCase.caseItem.caseId}
                    record={activeCase.record}
                    caseItem={activeCase.caseItem}
                    formulas={chenfu.formulas}
                    compact
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
