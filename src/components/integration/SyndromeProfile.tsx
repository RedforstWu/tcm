import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  faBookOpen,
  faCodeCompare,
  faNotesMedical,
  faPills,
  faStethoscope,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { Concept } from '@/types/ontology'
import type { GraphEdge, GraphNode } from '@/types/graph'
import { incident, incoming, loadConcepts, lookupGraphNodes } from '@/lib/graph'
import {
  channelConceptIdFromSixChannel,
  clauseHref,
  readSyndromeProfile,
} from '@/lib/integration'
import { convertScript, type ScriptMode } from '@/lib/text'
import { EvidenceBadge } from './EvidenceBadge'

interface LinkItem {
  id: string
  label: string
  href: string | null
}

interface DifferentialItem extends LinkItem {
  note?: string
  evidenceLevel?: string
}

interface SyndromeGraphData {
  conceptById: Map<string, Concept>
  formulas: LinkItem[]
  clauses: LinkItem[]
  differentials: DifferentialItem[]
}

const EMPTY_DATA: SyndromeGraphData = {
  conceptById: new Map(),
  formulas: [],
  clauses: [],
  differentials: [],
}

function stripFormulaPrefix(formulaId: string): string {
  return formulaId.replace(/^[\w-]+-formula-/, '')
}

function labelFromConceptId(conceptId: string): string {
  const dot = conceptId.indexOf('.')
  return dot > 0 ? conceptId.slice(dot + 1) : conceptId
}

function edgeNote(edge: GraphEdge): string | undefined {
  const note = edge.attributes?.note
  return typeof note === 'string' && note.trim() ? note : undefined
}

async function loadSyndromeGraphData(concept: Concept): Promise<SyndromeGraphData> {
  const profile = readSyndromeProfile(concept)
  const [concepts, treats, differentiates, nodeById] = await Promise.all([
    loadConcepts().catch(() => [] as Concept[]),
    incoming(concept.id, ['treatsConcept']),
    incident(concept.id, ['differentiates']),
    lookupGraphNodes([...profile.mainFormulaIds, ...profile.clauseIds]),
  ])
  const conceptById = new Map(concepts.map((item) => [item.id, item]))

  const formulaMap = new Map<string, LinkItem>()
  const addFormula = (id: string, node?: GraphNode) => {
    if (formulaMap.has(id)) return
    formulaMap.set(id, {
      id,
      label: node?.label ?? stripFormulaPrefix(id),
      href: `/formulas/${encodeURIComponent(id)}`,
    })
  }
  for (const id of profile.mainFormulaIds) addFormula(id, nodeById.get(id))
  for (const { node } of treats) {
    if (node.type === 'formula') addFormula(node.id, node)
  }

  const clauses = [...new Set(profile.clauseIds)].map((id) => {
    const node = nodeById.get(id)
    return { id, label: node?.label ?? id, href: clauseHref(id, node?.bookId) }
  })

  const differentialMap = new Map<string, DifferentialItem>()
  const addDifferential = (id: string, note?: string, evidenceLevel?: string, node?: GraphNode) => {
    if (id === concept.id) return
    const existing = differentialMap.get(id)
    if (existing) {
      existing.note ??= note
      existing.evidenceLevel ??= evidenceLevel
      return
    }
    const target = conceptById.get(id)
    differentialMap.set(id, {
      id,
      label: target?.prefLabel ?? node?.label ?? labelFromConceptId(id),
      href: target ? `/concept/${encodeURIComponent(id)}` : null,
      ...(note ? { note } : {}),
      ...(evidenceLevel ? { evidenceLevel } : {}),
    })
  }
  for (const item of profile.differentials) addDifferential(item.targetConceptId, item.note)
  for (const { edge, node } of differentiates) {
    if (node.type === 'concept') addDifferential(node.id, edgeNote(edge), edge.evidenceLevel, node)
  }

  return {
    conceptById,
    formulas: [...formulaMap.values()],
    clauses,
    differentials: [...differentialMap.values()],
  }
}

function Row({ icon, title, children }: { icon: IconDefinition; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
        <FontAwesomeIcon icon={icon} className="text-[11px] text-teal" />
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

export interface SyndromeProfileSectionProps {
  concept: Concept
  scriptMode?: ScriptMode
}

/** 证型概念详情：六经、主症、主方、主条文、鉴别证型；数据全缺时不渲染 */
export function SyndromeProfileSection({ concept, scriptMode = 'simplified' }: SyndromeProfileSectionProps) {
  const profile = useMemo(() => readSyndromeProfile(concept), [concept])
  const [loaded, setLoaded] = useState<{ conceptId: string; data: SyndromeGraphData } | null>(null)
  const data = loaded?.conceptId === concept.id ? loaded.data : EMPTY_DATA

  useEffect(() => {
    let cancelled = false
    loadSyndromeGraphData(concept)
      .then((result) => {
        if (!cancelled) setLoaded({ conceptId: concept.id, data: result })
      })
      .catch((error: unknown) => {
        console.warn('[syndrome] 图谱数据加载失败', error)
      })
    return () => {
      cancelled = true
    }
  }, [concept])

  const text = (value: string) => convertScript(value, scriptMode)
  const channelId = profile.sixChannel ? channelConceptIdFromSixChannel(profile.sixChannel) : null
  const isEmpty =
    !profile.sixChannel &&
    !profile.definition &&
    profile.mainSymptoms.length === 0 &&
    data.formulas.length === 0 &&
    data.clauses.length === 0 &&
    data.differentials.length === 0
  if (isEmpty) return null

  return (
    <section className="space-y-3 rounded-2xl border border-stone-200 bg-white/90 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
        <FontAwesomeIcon icon={faNotesMedical} className="text-cinnabar" />
        证型要点
      </h2>
      {profile.definition && (
        <p className="prose-classic rounded-xl bg-paper-dark/60 px-3 py-2 text-sm text-stone-700">
          {text(profile.definition)}
        </p>
      )}
      {profile.sixChannel && (
        <Row icon={faBookOpen} title="六经">
          {channelId && data.conceptById.has(channelId) ? (
            <Link
              to={`/concept/${encodeURIComponent(channelId)}`}
              className="rounded bg-teal-soft px-2 py-0.5 text-xs text-teal hover:underline"
            >
              {text(profile.sixChannel)}
            </Link>
          ) : (
            <span className="rounded bg-teal-soft px-2 py-0.5 text-xs text-teal">{text(profile.sixChannel)}</span>
          )}
        </Row>
      )}
      {profile.mainSymptoms.length > 0 && (
        <Row icon={faStethoscope} title="主症">
          {profile.mainSymptoms.map((symptom) => {
            const symptomId = `symptom.${symptom}`
            return data.conceptById.has(symptomId) ? (
              <Link
                key={symptom}
                to={`/concept/${encodeURIComponent(symptomId)}`}
                className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600 hover:bg-teal-soft hover:text-teal"
              >
                {text(symptom)}
              </Link>
            ) : (
              <span key={symptom} className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                {text(symptom)}
              </span>
            )
          })}
        </Row>
      )}
      {data.formulas.length > 0 && (
        <Row icon={faPills} title="主方">
          {data.formulas.map((formula) => (
            <Link
              key={formula.id}
              to={formula.href ?? '/formulas'}
              className="rounded-full bg-cinnabar-soft px-3 py-0.5 text-xs text-cinnabar hover:underline"
            >
              {text(formula.label)}
            </Link>
          ))}
        </Row>
      )}
      {data.clauses.length > 0 && (
        <Row icon={faBookOpen} title="主条文">
          {data.clauses.map((clause) =>
            clause.href ? (
              <Link
                key={clause.id}
                to={clause.href}
                className="rounded bg-paper-dark px-2 py-0.5 text-xs text-stone-700 hover:text-cinnabar"
              >
                {text(clause.label)}
              </Link>
            ) : (
              <span key={clause.id} className="rounded bg-paper-dark px-2 py-0.5 text-xs text-stone-500">
                {text(clause.label)}
              </span>
            ),
          )}
        </Row>
      )}
      {data.differentials.length > 0 && (
        <Row icon={faCodeCompare} title="鉴别证型">
          <ul className="w-full space-y-1.5">
            {data.differentials.map((item) => (
              <li key={item.id} className="rounded-xl border border-stone-100 bg-paper/60 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {item.href ? (
                    <Link to={item.href} className="font-medium text-cinnabar hover:underline">
                      {text(item.label)}
                    </Link>
                  ) : (
                    <span className="font-medium text-stone-700">{text(item.label)}</span>
                  )}
                  <EvidenceBadge level={item.evidenceLevel} />
                </div>
                {item.note && <p className="mt-1 text-stone-600">{text(item.note)}</p>}
              </li>
            ))}
          </ul>
        </Row>
      )}
    </section>
  )
}
