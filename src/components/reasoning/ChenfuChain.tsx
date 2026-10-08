import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  faBookOpen,
  faCircleNodes,
  faCircleQuestion,
  faHourglassHalf,
  faLink,
  faMortarPestle,
  faScaleBalanced,
  faStethoscope,
  faTriangleExclamation,
  faYinYang,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { WuxingGraph } from '@/components/reasoning/WuxingGraph'
import {
  CHENFU_BOOK_LABELS,
  DISPUTE_KIND_LABELS,
  DISPUTE_KIND_STYLES,
  routeDisputes,
  symptomDisplay,
} from '@/lib/chenfu'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import type { CaseDispute, ChenfuCase, ChenfuFormula, ChenfuRecord } from '@/types/data'

interface ChenfuChainProps {
  record: ChenfuRecord
  caseItem?: ChenfuCase
  formulas: Record<string, ChenfuFormula>
  /** 对照视图用：缩小五行图 */
  compact?: boolean
}

const GRAPH_HEIGHT = 240
const GRAPH_HEIGHT_COMPACT = 200

function readerLink(book: string, clauseId: string): string {
  return `/read/${book}?clause=${encodeURIComponent(clauseId)}`
}

function bookOfClauseId(clauseId: string): string {
  return clauseId.replace(/-\d+$/, '')
}

function Panel({
  step,
  title,
  icon,
  children,
}: {
  step: number
  title: string
  icon: IconDefinition
  children: ReactNode
}) {
  return (
    <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-stone-700">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-100 text-[11px] text-stone-500">
          {step}
        </span>
        <FontAwesomeIcon icon={icon} className="text-cinnabar" />
        {title}
      </h4>
      {children}
    </section>
  )
}

function DisputeList({ disputes }: { disputes: CaseDispute[] }) {
  const { scriptMode } = useAppContext()
  return (
    <ul className="space-y-2">
      {disputes.map((dispute, index) => (
        <li key={`${dispute.kind}-${index}`} className="rounded-lg bg-stone-50 p-2 text-xs leading-relaxed">
          <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${DISPUTE_KIND_STYLES[dispute.kind]}`}>
            {DISPUTE_KIND_LABELS[dispute.kind]}
          </span>
          <p className="text-stone-500 line-through decoration-stone-300">
            {convertScript(dispute.claim, scriptMode)}
          </p>
          <p className="prose-classic mt-0.5 text-stone-800">{convertScript(dispute.rebuttal, scriptMode)}</p>
        </li>
      ))}
    </ul>
  )
}

function HighlightedFangjie({ fangjie, keySentence }: { fangjie: string; keySentence?: string }) {
  const { scriptMode } = useAppContext()
  if (!fangjie.trim()) return <p className="text-xs text-stone-400">原文无方解</p>
  const start = keySentence ? fangjie.indexOf(keySentence) : -1
  if (!keySentence || start < 0) {
    return (
      <>
        {keySentence && (
          <p className="mb-1 rounded bg-amber-soft px-2 py-1 text-xs text-amber-900">
            {convertScript(keySentence, scriptMode)}
          </p>
        )}
        <p className="prose-classic text-xs leading-relaxed text-stone-600">{convertScript(fangjie, scriptMode)}</p>
      </>
    )
  }
  const end = start + keySentence.length
  return (
    <p className="prose-classic text-xs leading-relaxed text-stone-600">
      {convertScript(fangjie.slice(0, start), scriptMode)}
      <mark className="rounded bg-amber-soft px-0.5 text-amber-900">
        {convertScript(fangjie.slice(start, end), scriptMode)}
      </mark>
      {convertScript(fangjie.slice(end), scriptMode)}
    </p>
  )
}

export function ChenfuChain({ record, caseItem, formulas, compact = false }: ChenfuChainProps) {
  const { scriptMode } = useAppContext()
  const [formulaTab, setFormulaTab] = useState(0)

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-stone-400">
          {CHENFU_BOOK_LABELS[record.book]} · {convertScript(record.chapter, scriptMode)}
          {record.heading ? ` · ${convertScript(record.heading, scriptMode)}` : ''}
        </p>
        {caseItem?.methodCategory && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-teal px-2.5 py-0.5 text-xs text-white">
            <FontAwesomeIcon icon={faScaleBalanced} />
            治法类别：{convertScript(caseItem.methodCategory, scriptMode)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          to={readerLink(record.book, record.clauseId)}
          className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-teal hover:bg-teal-soft"
        >
          <FontAwesomeIcon icon={faBookOpen} className="mr-1" />
          阅读原文
        </Link>
        {record.parallelIds.map((parallelId) => (
          <Link
            key={parallelId}
            to={readerLink(bookOfClauseId(parallelId), parallelId)}
            className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-stone-600 hover:bg-stone-50"
          >
            另见 {parallelId}
          </Link>
        ))}
      </div>
    </div>
  )

  if (!record.annotated || !caseItem) {
    return (
      <div className="space-y-3">
        {header}
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white px-4 py-6 text-sm text-stone-500">
          <FontAwesomeIcon icon={faHourglassHalf} className="text-stone-400" />
          {record.annotated ? '本则原文未抽出可成链的病案。' : '待标注：本则尚未完成病机链抽取，可先阅读原文。'}
        </div>
      </div>
    )
  }

  const routed = routeDisputes(caseItem.disputes)
  const symptom = symptomDisplay(caseItem, record)
  const formulaIds = caseItem.formulaIds.filter((formulaId) => formulas[formulaId])
  const activeFormula = formulas[formulaIds[Math.min(formulaTab, formulaIds.length - 1)] ?? '']
  const keySentence = formulaTab === 0 ? caseItem.keySentence : undefined
  const showDiagnosis = routed.diagnosis.length > 0
  const stepOffset = showDiagnosis ? 1 : 0
  const steps = {
    symptom: 1,
    diagnosis: 2,
    pathogenesis: 2 + stepOffset,
    organs: 3 + stepOffset,
    treatment: 4 + stepOffset,
    formula: 5 + stepOffset,
  }

  return (
    <div className="space-y-3">
      {header}

      {caseItem.disputes.length === 0 && (
        <p className="inline-block rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600">
          本则直述证治：原文未设辩难，链条由症状直接进入病机
        </p>
      )}

      <div className={`grid gap-3 md:grid-cols-2 ${compact ? '' : 'xl:grid-cols-3'}`}>
        <Panel step={steps.symptom} title="症状原文" icon={faStethoscope}>
          <p className="prose-classic text-sm leading-relaxed text-stone-800">
            {convertScript(symptom.text, scriptMode)}
          </p>
          {symptom.note && <p className="mt-1 text-[11px] text-stone-400">{symptom.note}</p>}
          {symptom.linkClauseId && (
            <Link
              to={readerLink(record.book, symptom.linkClauseId)}
              className="mt-1 inline-block text-xs text-teal hover:underline"
            >
              查看上一则
            </Link>
          )}
          {record.symptomTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {record.symptomTags.map((tag) => (
                <span key={tag} className="rounded-full bg-cinnabar-soft px-2 py-0.5 text-[11px] text-cinnabar">
                  {convertScript(tag, scriptMode)}
                </span>
              ))}
            </div>
          )}
        </Panel>

        {showDiagnosis && (
          <Panel step={steps.diagnosis} title="辨误" icon={faTriangleExclamation}>
            <DisputeList disputes={routed.diagnosis} />
          </Panel>
        )}

        <Panel step={steps.pathogenesis} title="病机" icon={faYinYang}>
          {caseItem.pathogenesis ? (
            <p className="prose-classic rounded-lg bg-teal-soft/60 px-3 py-2 text-sm leading-relaxed text-teal">
              {convertScript(caseItem.pathogenesis, scriptMode)}
            </p>
          ) : (
            <p className="text-xs text-stone-400">原文未单列病机句</p>
          )}
          {record.pathogenesisTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {record.pathogenesisTags.map((tag) => (
                <span key={tag} className="rounded-full bg-teal-soft px-2 py-0.5 text-[11px] text-teal">
                  {convertScript(tag, scriptMode)}
                </span>
              ))}
            </div>
          )}
        </Panel>

        <Panel step={steps.organs} title="脏腑生克" icon={faCircleNodes}>
          {caseItem.organs.length === 0 ? (
            <p className="text-xs text-stone-400">原文未明言脏腑</p>
          ) : (
            <WuxingGraph
              organs={caseItem.organs}
              relations={caseItem.relations}
              height={compact ? GRAPH_HEIGHT_COMPACT : GRAPH_HEIGHT}
            />
          )}
        </Panel>

        <Panel step={steps.treatment} title="治法" icon={faScaleBalanced}>
          {caseItem.treatmentPrinciple ? (
            <p className="prose-classic text-sm leading-relaxed text-stone-800">
              {convertScript(caseItem.treatmentPrinciple, scriptMode)}
            </p>
          ) : (
            <p className="text-xs text-stone-400">原文未单列治法句</p>
          )}
          {routed.treatment.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] text-stone-400">反例（误治警示）</p>
              <DisputeList disputes={routed.treatment} />
            </div>
          )}
        </Panel>

        <Panel step={steps.formula} title="方药与方解" icon={faMortarPestle}>
          {formulaIds.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1" role="tablist">
              {formulaIds.map((formulaId, index) => (
                <button
                  key={formulaId}
                  type="button"
                  role="tab"
                  aria-selected={index === formulaTab}
                  onClick={() => setFormulaTab(index)}
                  className={`rounded-full px-2.5 py-0.5 text-xs ${
                    index === formulaTab ? 'bg-cinnabar text-white' : 'bg-stone-100 text-stone-600 hover:bg-cinnabar-soft'
                  }`}
                >
                  {index === 0 ? '主方' : `备选${index}`}
                </button>
              ))}
            </div>
          )}
          {activeFormula ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-serif font-semibold text-cinnabar">
                  {convertScript(activeFormula.name, scriptMode)}
                </span>
                <Link
                  to={`/formulas/${encodeURIComponent(activeFormula.id)}`}
                  className="shrink-0 text-xs text-teal hover:underline"
                >
                  <FontAwesomeIcon icon={faLink} className="mr-1" />
                  方剂页
                </Link>
              </div>
              <p className="rounded-lg bg-paper-dark/60 p-2 text-xs leading-relaxed text-stone-700">
                {convertScript(activeFormula.preparation, scriptMode)}
              </p>
              <HighlightedFangjie fangjie={activeFormula.fangjie} keySentence={keySentence} />
            </div>
          ) : caseItem.formulaText ? (
            <div>
              <p className="prose-classic rounded-lg bg-paper-dark/60 p-2 text-xs leading-relaxed text-stone-700">
                {convertScript(caseItem.formulaText, scriptMode)}
              </p>
              <p className="mt-1 text-[11px] text-stone-400">方药原文摘录（未入方剂库）</p>
            </div>
          ) : (
            <p className="text-xs text-stone-400">本案原文未出方</p>
          )}
          {caseItem.prescriptionFromClauseId && (
            <p className="mt-2 text-[11px] text-stone-400">
              原文切分处，本案方药位于下一则开头
              <Link
                to={readerLink(record.book, caseItem.prescriptionFromClauseId)}
                className="ml-1 text-teal hover:underline"
              >
                查看下一则
              </Link>
            </p>
          )}
          {routed.formula.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 flex items-center gap-1 text-[11px] text-stone-400">
                <FontAwesomeIcon icon={faCircleQuestion} />
                用药辨难
              </p>
              <DisputeList disputes={routed.formula} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
