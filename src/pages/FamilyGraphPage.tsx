import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Link } from 'react-router-dom'
import type { Clause, Formula, FormulaDiffPair, FormulaFamily } from '@/types/data'
import { loadAllClauses, loadDiffPairs, loadFamilies, loadFormulas } from '@/lib/data'
import {
  buildFamilyRelations,
  resolveFamilyRoot,
  type FormulaRelation,
} from '@/lib/formula-diff'
import { FormulaCompareDrawer } from '@/components/FormulaCompareDrawer'
import { useIsCompactScreen } from '@/lib/use-media-query'

const GRAPH_HEIGHT = 580
const GRAPH_HEIGHT_COMPACT = 440

const JINGFANG_BOOKS = new Set(['songben', 'jingui', 'guilin'])
const BOOK_LABEL: Record<string, string> = {
  songben: '宋本',
  jingui: '金匮',
  guilin: '桂林',
}
const BOOK_COLOR: Record<string, string> = {
  songben: '#0f766e',
  jingui: '#b45309',
  guilin: '#7c3aed',
}

const EDGE_STYLE = {
  add: { color: '#0f766e', label: '加', lineType: 'solid' as const, width: 2 },
  remove: { color: '#b91c1c', label: '去', lineType: 'solid' as const, width: 2 },
  dose: { color: '#d97706', label: '改', lineType: 'dashed' as const, width: 2 },
  multi: { color: '#7c3aed', label: '多', lineType: 'solid' as const, width: 2.2 },
}

const OVERVIEW_ID = '__overview__'

type GraphEdge = FormulaRelation & { source: string; target: string }

export function FamilyGraphPage() {
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [families, setFamilies] = useState<FormulaFamily[]>([])
  const [diffs, setDiffs] = useState<FormulaDiffPair[]>([])
  const [clauses, setClauses] = useState<Clause[]>([])
  const [selectedFamily, setSelectedFamily] = useState(OVERVIEW_ID)
  const [edgeInfo, setEdgeInfo] = useState<GraphEdge | null>(null)
  const [drawerIds, setDrawerIds] = useState<string[]>([])
  const isCompact = useIsCompactScreen()

  useEffect(() => {
    void Promise.all([
      loadFormulas(),
      loadFamilies(),
      loadDiffPairs(),
      loadAllClauses('jingfang'),
    ]).then(([formulaList, familyList, diffList, clauseList]) => {
      const jingfang = formulaList.filter((item) => JINGFANG_BOOKS.has(item.book))
      const jingfangIds = new Set(jingfang.map((item) => item.id))
      const usableFamilies = familyList
        .map((family) => ({
          ...family,
          formulaIds: family.formulaIds.filter((id) => jingfangIds.has(id)),
        }))
        .filter((family) => family.formulaIds.length >= 2)
        .sort((a, b) => b.formulaIds.length - a.formulaIds.length)

      setFormulas(jingfang)
      setFamilies(usableFamilies)
      setDiffs(diffList.filter((diff) => jingfangIds.has(diff.fromId) && jingfangIds.has(diff.toId)))
      setClauses(clauseList)
      setSelectedFamily(usableFamilies[0]?.id ?? OVERVIEW_ID)
    })
  }, [])

  const closeDrawer = useCallback(() => setDrawerIds([]), [])

  const graphModel = useMemo(() => {
    const isOverview = selectedFamily === OVERVIEW_ID
    const family = families.find((item) => item.id === selectedFamily)
    const memberFormulas = isOverview
      ? formulas.filter((item) => item.book === 'songben')
      : formulas.filter((item) => family?.formulaIds.includes(item.id))

    const root =
      !isOverview && family
        ? resolveFamilyRoot(memberFormulas, family.baseFormulaId)
        : undefined

    // 总览只画单味加减/改剂量，避免多味边把网络糊成一团；家族视图用祖方星型含多味
    const relations: FormulaRelation[] = isOverview
      ? diffs
          .filter((diff) => diff.kind !== 'multi')
          .map((diff) => ({
            fromId: diff.fromId,
            toId: diff.toId,
            kind: diff.kind,
            label:
              diff.kind === 'add'
                ? `加·${diff.herbName}`
                : diff.kind === 'remove'
                  ? `去·${diff.herbName}`
                  : `改·${diff.herbName}`,
            added: (diff.addedHerbNames ?? []).map((name) => ({ herbId: name, herbName: name })),
            removed: (diff.removedHerbNames ?? []).map((name) => ({
              herbId: name,
              herbName: name,
            })),
            doseChanged: [],
          }))
      : family
        ? buildFamilyRelations(memberFormulas, family.baseFormulaId)
        : []

    const count = memberFormulas.length
    const cx = 400
    const cy = 280
    const radius = Math.min(240, 80 + count * 8)

    const nodes = memberFormulas.map((item) => {
      const isRoot = root?.id === item.id
      let x: number | undefined
      let y: number | undefined
      if (!isOverview && root) {
        if (isRoot) {
          x = cx
          y = cy
        } else {
          const others = memberFormulas.filter((member) => member.id !== root.id)
          const order = others.findIndex((member) => member.id === item.id)
          const angle = (Math.PI * 2 * order) / Math.max(others.length, 1) - Math.PI / 2
          x = cx + radius * Math.cos(angle)
          y = cy + radius * Math.sin(angle)
        }
      }
      return {
        id: item.id,
        name: isOverview ? item.name : `${item.name}·${BOOK_LABEL[item.book] ?? item.book}`,
        symbolSize: isRoot ? 46 : Math.min(36, 16 + item.herbs.length * 2),
        itemStyle: {
          color: BOOK_COLOR[item.book] ?? '#57534e',
          borderColor: isRoot ? '#134e4a' : undefined,
          borderWidth: isRoot ? 3 : 0,
        },
        category: item.book === 'songben' ? 0 : item.book === 'jingui' ? 1 : 2,
        x,
        y,
        fixed: Boolean(!isOverview && isRoot),
        z: isRoot ? 10 : 1,
      }
    })

    const links: GraphEdge[] = relations.map((relation) => ({
      ...relation,
      source: relation.fromId,
      target: relation.toId,
    }))

    return { nodes, links, rootId: root?.id, isOverview }
  }, [families, formulas, diffs, selectedFamily])

  const { nodes, links, rootId, isOverview } = graphModel

  const option = useMemo(() => {
    const chartLinks = links.map((relation) => {
      const style = EDGE_STYLE[relation.kind]
      return {
        source: relation.source,
        target: relation.target,
        value: relation.label,
        kind: relation.kind,
        symbol: ['none', 'arrow'],
        symbolSize: [0, 8],
        lineStyle: {
          color: style.color,
          width: style.width,
          type: style.lineType,
          curveness: isOverview ? 0.12 : 0.08,
          opacity: 0.92,
        },
        label: {
          show: !isOverview || nodes.length <= 36,
          formatter: relation.label,
          fontSize: 10,
          color: style.color,
          backgroundColor: 'rgba(255,253,248,0.9)',
          padding: [1, 3],
        },
      }
    })

    return {
      tooltip: {
        formatter: (params: {
          dataType?: string
          data?: { name?: string; kind?: keyof typeof EDGE_STYLE; value?: string }
        }) => {
          if (params.dataType === 'edge') {
            const kind = params.data?.kind
            const full =
              kind === 'add'
                ? '加味'
                : kind === 'remove'
                  ? '去味'
                  : kind === 'dose'
                    ? '改剂量'
                    : '多味差异'
            return `${full}：${params.data?.value ?? ''}`
          }
          return params.data?.name ?? ''
        },
      },
      legend: {
        data: [BOOK_LABEL.songben, BOOK_LABEL.jingui, BOOK_LABEL.guilin],
        bottom: isCompact ? 8 : 28,
      },
      series: [
        {
          type: 'graph',
          layout: isOverview ? 'force' : 'none',
          roam: true,
          draggable: true,
          data: nodes,
          links: chartLinks,
          categories: [
            { name: BOOK_LABEL.songben, itemStyle: { color: BOOK_COLOR.songben } },
            { name: BOOK_LABEL.jingui, itemStyle: { color: BOOK_COLOR.jingui } },
            { name: BOOK_LABEL.guilin, itemStyle: { color: BOOK_COLOR.guilin } },
          ],
          label: {
            show: true,
            position: 'right',
            fontSize: isOverview ? 10 : 11,
          },
          force: isOverview ? { repulsion: 220, edgeLength: 70, gravity: 0.08 } : undefined,
          lineStyle: { curveness: 0.1 },
          emphasis: { focus: 'adjacency' },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: [0, 8],
        },
      ],
    }
  }, [nodes, links, isOverview, isCompact])

  const rootName = useMemo(() => {
    if (!rootId) return ''
    return formulas.find((item) => item.id === rootId)?.name ?? ''
  }, [rootId, formulas])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">方剂家族图</h1>
        <p className="text-sm text-stone-500">
          家族视图以祖方为根向外连线（含宋本·金匮·桂林）；总览为宋本差异网络。点击节点查看方剂。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedFamily}
          onChange={(event) => {
            setSelectedFamily(event.target.value)
            setEdgeInfo(null)
          }}
          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm sm:w-auto"
        >
          <option value={OVERVIEW_ID}>宋本差异总览</option>
          {families.map((family) => (
            <option key={family.id} value={family.id}>
              {family.name}（{family.formulaIds.length}）
            </option>
          ))}
        </select>
        <span className="text-sm text-stone-500">
          当前 {nodes.length} 方
          {rootName ? ` · 根：${rootName}` : ''}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-600">
          <span className="inline-flex items-center gap-1.5 text-teal">
            <span className="inline-block h-0.5 w-5 bg-teal" />
            加味
          </span>
          <span className="inline-flex items-center gap-1.5 text-cinnabar">
            <span className="inline-block h-0.5 w-5 bg-cinnabar" />
            去味
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: '#d97706' }}>
            <span
              className="inline-block h-0 w-5 border-t-2 border-dashed"
              style={{ borderColor: '#d97706' }}
            />
            改剂量
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: '#7c3aed' }}>
            <span className="inline-block h-0.5 w-5" style={{ background: '#7c3aed' }} />
            多味差异
          </span>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <ReactECharts
          option={option}
          style={{ height: isCompact ? GRAPH_HEIGHT_COMPACT : GRAPH_HEIGHT }}
          notMerge
          onEvents={{
            click: (params: {
              dataType?: string
              data?: {
                id?: string
                source?: string
                target?: string
                value?: string
                kind?: string
              }
            }) => {
              if (params.dataType === 'node' && params.data?.id) {
                const id = params.data.id
                setDrawerIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
                setEdgeInfo(null)
                return
              }
              if (params.dataType !== 'edge' || !params.data?.source || !params.data?.target) return
              const hit =
                links.find(
                  (link) =>
                    link.source === params.data?.source &&
                    link.target === params.data?.target &&
                    link.label === params.data?.value,
                ) ??
                links.find(
                  (link) =>
                    link.source === params.data?.source && link.target === params.data?.target,
                ) ??
                null
              setEdgeInfo(hit)
            },
          }}
        />
      </div>
      {edgeInfo && (
        <div
          className="rounded-2xl border p-4 text-sm"
          style={{
            borderColor: EDGE_STYLE[edgeInfo.kind].color,
            backgroundColor:
              edgeInfo.kind === 'add'
                ? 'rgba(15,118,110,0.08)'
                : edgeInfo.kind === 'remove'
                  ? 'rgba(185,28,28,0.08)'
                  : edgeInfo.kind === 'dose'
                    ? 'rgba(217,119,6,0.1)'
                    : 'rgba(124,58,237,0.08)',
          }}
        >
          <p className="font-medium" style={{ color: EDGE_STYLE[edgeInfo.kind].color }}>
            {edgeInfo.kind === 'add'
              ? '加味'
              : edgeInfo.kind === 'remove'
                ? '去味'
                : edgeInfo.kind === 'dose'
                  ? '改剂量'
                  : '多味差异'}
            ：{edgeInfo.label}
          </p>
          {(edgeInfo.added.length > 0 ||
            edgeInfo.removed.length > 0 ||
            edgeInfo.doseChanged.length > 0) && (
            <ul className="mt-2 space-y-1 text-stone-600">
              {edgeInfo.added.map((item) => (
                <li key={`a-${item.herbId}`}>加 {item.herbName}</li>
              ))}
              {edgeInfo.removed.map((item) => (
                <li key={`r-${item.herbId}`}>去 {item.herbName}</li>
              ))}
              {edgeInfo.doseChanged.map((item) => (
                <li key={`d-${item.herbId}`}>
                  改 {item.herbName}（{item.fromDoseRaw ?? '?'} → {item.toDoseRaw ?? '?'}）
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="underline"
              onClick={() => setDrawerIds([edgeInfo.fromId, edgeInfo.toId])}
            >
              对比两方
            </button>
            <Link className="underline" to={`/formulas/${encodeURIComponent(edgeInfo.fromId)}`}>
              方 A
            </Link>
            <Link className="underline" to={`/formulas/${encodeURIComponent(edgeInfo.toId)}`}>
              方 B
            </Link>
          </div>
        </div>
      )}
      <FormulaCompareDrawer
        openIds={drawerIds}
        formulas={formulas}
        clauses={clauses}
        variant="dock"
        onClose={closeDrawer}
        onRemove={(id) => setDrawerIds((prev) => prev.filter((item) => item !== id))}
      />
    </div>
  )
}
