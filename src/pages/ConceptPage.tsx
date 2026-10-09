import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { faArrowLeft, faBookOpen, faPills, faTags } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { Concept } from '@/types/ontology'
import type { GraphEdge, GraphNode } from '@/types/graph'
import { bookTitle } from '@/lib/data'
import { getConcept, incoming } from '@/lib/graph'
import { conceptTypeLabel } from '@/lib/concept'
import { SyndromeProfileSection } from '@/components/integration/SyndromeProfile'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import { DraftBanner } from '@/components/DraftBanner'

interface NeighborGroup {
  school: string
  items: Array<{ edge: GraphEdge; node: GraphNode }>
}

export function ConceptPage() {
  const { conceptId: rawId = '' } = useParams()
  const conceptId = decodeURIComponent(rawId)
  const { scriptMode } = useAppContext()
  const [concept, setConcept] = useState<Concept | null>(null)
  const [clauseHits, setClauseHits] = useState<Array<{ edge: GraphEdge; node: GraphNode }>>([])
  const [caseHits, setCaseHits] = useState<Array<{ edge: GraphEdge; node: GraphNode }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      const found = await getConcept(conceptId)
      if (cancelled) return
      setConcept(found ?? null)
      if (!found) {
        setClauseHits([])
        setCaseHits([])
        setLoading(false)
        return
      }
      const mentions = await incoming(conceptId, ['mentionsConcept', 'organRelation'])
      if (cancelled) return
      setClauseHits(mentions.filter((item) => item.node.type === 'clause'))
      setCaseHits(mentions.filter((item) => item.node.type === 'case'))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [conceptId])

  const groups = useMemo(() => {
    const bySchool = new Map<string, NeighborGroup>()
    for (const item of clauseHits) {
      const school =
        item.edge.school ??
        (item.node.bookId ? bookTitle(item.node.bookId as never) : '未分派')
      const group = bySchool.get(school) ?? { school, items: [] }
      group.items.push(item)
      bySchool.set(school, group)
    }
    return [...bySchool.values()]
  }, [clauseHits])

  if (loading) {
    return <p className="text-stone-500">概念加载中…</p>
  }

  if (!concept) {
    return (
      <div className="space-y-3">
        <Link to="/search" className="text-sm text-teal hover:underline">
          <FontAwesomeIcon icon={faArrowLeft} className="mr-1" />
          返回搜索
        </Link>
        <p className="text-stone-600">未找到概念「{conceptId}」。</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to="/read/songben" className="inline-flex items-center gap-1 text-teal hover:underline">
          <FontAwesomeIcon icon={faArrowLeft} />
          返回条文
        </Link>
        <Link
          to={`/graph?seed=${encodeURIComponent(conceptId)}`}
          className="text-teal hover:underline"
        >
          在图谱中展开
        </Link>
      </div>

      {concept.reviewStatus === 'ai-draft' && <DraftBanner />}

      <header className="rounded-2xl border border-stone-200 bg-white/90 p-4 sm:p-5">
        <p className="mb-1 text-xs tracking-wide text-stone-400">{conceptTypeLabel(concept.type)}</p>
        <h1 className="font-serif text-2xl font-bold text-ink">
          {convertScript(concept.prefLabel, scriptMode)}
        </h1>
        {concept.altLabels.length > 0 && (
          <p className="mt-2 text-sm text-stone-500">
            <FontAwesomeIcon icon={faTags} className="mr-1" />
            异名：{concept.altLabels.map((label) => convertScript(label, scriptMode)).join('、')}
          </p>
        )}
        {concept.schoolNotes?.map((note) => (
          <p key={`${note.school}-${note.note}`} className="mt-2 rounded-xl bg-amber-soft/40 px-3 py-2 text-xs text-amber-900">
            <span className="font-medium">{note.school}：</span>
            {convertScript(note.note, scriptMode)}
          </p>
        ))}
      </header>

      {concept.type === 'syndrome' && <SyndromeProfileSection concept={concept} scriptMode={scriptMode} />}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
          <FontAwesomeIcon icon={faBookOpen} className="text-teal" />
          相关条文（{clauseHits.length}）
        </h2>
        {groups.length === 0 && <p className="text-sm text-stone-500">暂无关联条文。</p>}
        {groups.map((group) => (
          <div key={group.school} className="rounded-2xl border border-stone-200 bg-white/80 p-3">
            <p className="mb-2 text-xs font-medium text-stone-500">{group.school}</p>
            <ul className="space-y-2">
              {group.items.slice(0, 40).map(({ edge, node }) => (
                <li key={edge.id}>
                  <Link
                    to={
                      node.bookId
                        ? `/read/${node.bookId}?clause=${encodeURIComponent(node.id)}`
                        : '/search'
                    }
                    className="block rounded-xl px-2 py-1.5 text-sm hover:bg-teal-soft"
                  >
                    <span className="font-medium text-cinnabar">
                      {convertScript(node.label, scriptMode)}
                    </span>
                    {edge.reviewStatus === 'ai-draft' && (
                      <span className="ml-2 rounded bg-amber-soft px-1.5 py-0.5 text-[10px] text-amber-800">
                        ai-draft
                      </span>
                    )}
                    {edge.sourceClauseId && (
                      <span className="ml-2 text-xs text-stone-400">出处 {edge.sourceClauseId}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {caseHits.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
            <FontAwesomeIcon icon={faPills} className="text-cinnabar" />
            相关医案（{caseHits.length}）
          </h2>
          <ul className="rounded-2xl border border-stone-200 bg-white/80 p-3 text-sm">
            {caseHits.slice(0, 20).map(({ edge, node }) => (
              <li key={edge.id} className="border-b border-stone-100 py-2 last:border-0">
                <Link to="/reasoning" className="text-stone-700 hover:text-cinnabar">
                  {convertScript(node.label, scriptMode)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
