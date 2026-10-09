import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import {
  faCircleNodes,
  faMagnifyingGlass,
  faRotateRight,
  faUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { EdgeType, GraphEdge, GraphNode, NodeType } from '@/types/graph'
import {
  expandNeighborhood,
  hrefForGraphNode,
  loadGraphNodes,
  searchGraphNodes,
} from '@/lib/graph'
import { convertScript } from '@/lib/text'
import { useAppContext } from '@/context/AppContext'
import { useIsCompactScreen } from '@/lib/use-media-query'

const GRAPH_HEIGHT = 620
const GRAPH_HEIGHT_COMPACT = 460

const NODE_TYPE_META: Array<{ id: NodeType; label: string; color: string }> = [
  { id: 'book', label: '古籍', color: '#0f766e' },
  { id: 'formula', label: '方剂', color: '#b91c1c' },
  { id: 'concept', label: '证/概念', color: '#b45309' },
  { id: 'herb', label: '药物', color: '#15803d' },
  { id: 'clause', label: '条文', color: '#6366f1' },
  { id: 'case', label: '医案', color: '#7c3aed' },
  { id: 'monograph', label: '本草', color: '#0369a1' },
  { id: 'commentary', label: '注家', color: '#be185d' },
]

/** 数据中出现未登记的节点类型时归入此类，避免图例错位 */
const UNKNOWN_NODE_META = { label: '其他', color: '#78716c' }

const EDGE_TYPE_META: Array<{ id: EdgeType; label: string; color: string }> = [
  { id: 'containsClause', label: '含条文', color: '#78716c' },
  { id: 'citesFormula', label: '出方', color: '#b91c1c' },
  { id: 'hasHerb', label: '含药', color: '#15803d' },
  { id: 'treatsConcept', label: '主治', color: '#b45309' },
  { id: 'mentionsConcept', label: '提及', color: '#d97706' },
  { id: 'familyOf', label: '类方', color: '#7c3aed' },
  { id: 'derivedFrom', label: '衍化', color: '#c026d3' },
  { id: 'crossLink', label: '跨派', color: '#0891b2' },
  { id: 'prerequisite', label: '先修', color: '#0f766e' },
  { id: 'herbRole', label: '方解角色', color: '#65a30d' },
  { id: 'organRelation', label: '脏腑关系', color: '#dc2626' },
  { id: 'aligned', label: '版本对齐', color: '#57534e' },
  { id: 'parallel', label: '对照', color: '#a8a29e' },
  { id: 'commentsOn', label: '注释', color: '#db2777' },
  { id: 'differentiates', label: '鉴别', color: '#ea580c' },
]

const DEFAULT_NODE_TYPES: NodeType[] = ['book', 'formula', 'concept', 'herb', 'clause']
const DEFAULT_EDGE_TYPES: EdgeType[] = [
  'containsClause',
  'citesFormula',
  'hasHerb',
  'treatsConcept',
  'mentionsConcept',
  'familyOf',
  'prerequisite',
]

const PRESETS: Array<{ label: string; seedId: string }> = [
  { label: '桂枝汤', seedId: 'songben-formula-桂枝汤' },
  { label: '恶寒', seedId: 'symptom.恶寒' },
  { label: '桂枝', seedId: '桂枝' },
  { label: '宋本伤寒论', seedId: 'songben' },
  { label: '少阳', seedId: 'channel.少阳' },
]

function conceptKindLabel(node: GraphNode): string {
  if (node.type !== 'concept') return NODE_TYPE_META.find((item) => item.id === node.type)?.label ?? node.type
  const prefix = node.id.split('.')[0]
  const map: Record<string, string> = {
    symptom: '症状',
    pulse: '脉象',
    pathogenesis: '病机',
    channel: '经络',
    organ: '脏腑',
    method: '治法',
    syndrome: '证型',
  }
  return map[prefix ?? ''] ?? '概念'
}

function edgeLabel(type: EdgeType): string {
  return EDGE_TYPE_META.find((item) => item.id === type)?.label ?? type
}

export function OntologyGraphPage() {
  const { scriptMode } = useAppContext()
  const isCompact = useIsCompactScreen()
  const [searchParams, setSearchParams] = useSearchParams()
  const seedFromUrl = searchParams.get('seed') ?? PRESETS[0]!.seedId

  const [allNodes, setAllNodes] = useState<GraphNode[]>([])
  const [query, setQuery] = useState('')
  const [seedId, setSeedId] = useState(seedFromUrl)
  const [depth, setDepth] = useState(1)
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>(DEFAULT_NODE_TYPES)
  const [edgeTypes, setEdgeTypes] = useState<EdgeType[]>(DEFAULT_EDGE_TYPES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [graph, setGraph] = useState<{
    nodes: GraphNode[]
    edges: GraphEdge[]
    truncated: boolean
  } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void loadGraphNodes().then(setAllNodes)
  }, [])

  useEffect(() => {
    if (seedFromUrl !== seedId) setSeedId(seedFromUrl)
  }, [seedFromUrl])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void expandNeighborhood(seedId, {
      edgeTypes,
      nodeTypes,
      depth,
      maxNodes: isCompact ? 50 : 90,
    })
      .then((result) => {
        if (cancelled) return
        if (result.nodes.length === 0) {
          setError(`未找到种子节点「${seedId}」`)
          setGraph(null)
        } else {
          setGraph({ nodes: result.nodes, edges: result.edges, truncated: result.truncated })
          setSelectedId(seedId)
        }
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载失败')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [seedId, depth, nodeTypes, edgeTypes, isCompact])

  const suggestions = useMemo(
    () => searchGraphNodes(allNodes, query, 12),
    [allNodes, query],
  )

  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null
  const selectedHref = selected ? hrefForGraphNode(selected) : null

  const chartOption = useMemo(() => {
    if (!graph) return null
    const knownNodeTypes = new Set<string>(NODE_TYPE_META.map((item) => item.id))
    const hasUnknownNode = graph.nodes.some((node) => !knownNodeTypes.has(node.type))
    const categories = [
      ...NODE_TYPE_META.map((item) => ({ name: item.label, itemStyle: { color: item.color } })),
      ...(hasUnknownNode
        ? [{ name: UNKNOWN_NODE_META.label, itemStyle: { color: UNKNOWN_NODE_META.color } }]
        : []),
    ]
    const categoryIndex = Object.fromEntries(NODE_TYPE_META.map((item, index) => [item.id, index]))
    const colorOf = Object.fromEntries(NODE_TYPE_META.map((item) => [item.id, item.color]))
    const edgeColor = Object.fromEntries(EDGE_TYPE_META.map((item) => [item.id, item.color]))

    return {
      tooltip: {
        formatter: (params: { dataType?: string; data?: { name?: string; edgeType?: string } }) => {
          if (params.dataType === 'edge') {
            return edgeLabel((params.data?.edgeType as EdgeType) ?? 'hasHerb')
          }
          return params.data?.name ?? ''
        },
      },
      legend: [{ data: categories.map((item) => item.name), bottom: 0, type: 'scroll' }],
      series: [
        {
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          categories,
          force: {
            repulsion: isCompact ? 120 : 220,
            edgeLength: isCompact ? [40, 100] : [60, 140],
            gravity: 0.08,
          },
          label: {
            show: true,
            position: 'right',
            fontSize: 11,
            formatter: (params: { data?: { shortName?: string } }) => params.data?.shortName ?? '',
          },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: 6,
          lineStyle: { opacity: 0.65, curveness: 0.08 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3 } },
          data: graph.nodes.map((node) => ({
            id: node.id,
            name: convertScript(node.label, scriptMode),
            shortName: convertScript(node.label, scriptMode).slice(0, 8),
            category: categoryIndex[node.type] ?? NODE_TYPE_META.length,
            symbolSize: node.id === seedId ? 34 : node.type === 'book' ? 28 : 18,
            itemStyle: {
              color: colorOf[node.type] ?? UNKNOWN_NODE_META.color,
              borderColor: node.id === seedId ? '#1c1917' : undefined,
              borderWidth: node.id === seedId ? 2 : 0,
            },
          })),
          links: graph.edges.map((edge) => ({
            source: edge.from,
            target: edge.to,
            edgeType: edge.type,
            label: {
              show: graph.edges.length < 40,
              formatter: edgeLabel(edge.type),
              fontSize: 10,
              color: '#78716c',
            },
            lineStyle: {
              color: edgeColor[edge.type] ?? '#a8a29e',
              width: edge.type === 'treatsConcept' || edge.type === 'hasHerb' ? 1.6 : 1.2,
            },
          })),
        },
      ],
    }
  }, [graph, seedId, scriptMode, isCompact])

  function chooseSeed(id: string) {
    setSeedId(id)
    setSearchParams({ seed: id })
    setQuery('')
  }

  function toggleNodeType(type: NodeType) {
    setNodeTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    )
  }

  function toggleEdgeType(type: EdgeType) {
    setEdgeTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    )
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-bold">
            <FontAwesomeIcon icon={faCircleNodes} className="mr-2 text-cinnabar" />
            本体关系图谱
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            以古籍、方剂、证候概念、药物为节点，按需展开邻域（全图过大，默认深度 1）。
          </p>
        </div>
        <Link to="/formulas/family" className="text-sm text-teal hover:underline">
          方剂家族图
        </Link>
      </header>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="space-y-3 rounded-2xl border border-stone-200 bg-white/90 p-3 sm:p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.seedId}
                type="button"
                onClick={() => chooseSeed(preset.seedId)}
                className={`rounded-full px-3 py-1 text-xs ${
                  seedId === preset.seedId
                    ? 'bg-cinnabar text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-teal-soft'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <FontAwesomeIcon
              icon={faMagnifyingGlass}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索古籍 / 方名 / 药名 / 证候…"
              className="w-full rounded-xl border border-stone-200 py-2 pl-9 pr-3 text-sm"
            />
            {suggestions.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-stone-200 bg-white shadow-lg">
                {suggestions.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-teal-soft"
                      onClick={() => chooseSeed(node.id)}
                    >
                      <span>{convertScript(node.label, scriptMode)}</span>
                      <span className="text-xs text-stone-400">{conceptKindLabel(node)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-stone-600">
              深度
              <select
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
                className="rounded-lg border border-stone-200 px-2 py-1"
              >
                <option value={1}>1 跳</option>
                <option value={2}>2 跳</option>
              </select>
            </label>
            <button
              type="button"
              className="rounded-lg border border-stone-200 px-2 py-1 text-stone-600 hover:bg-stone-50"
              onClick={() => {
                setNodeTypes(DEFAULT_NODE_TYPES)
                setEdgeTypes(DEFAULT_EDGE_TYPES)
                setDepth(1)
              }}
            >
              <FontAwesomeIcon icon={faRotateRight} className="mr-1" />
              重置筛选
            </button>
            {graph && (
              <span className="text-xs text-stone-400">
                {graph.nodes.length} 节点 · {graph.edges.length} 边
                {graph.truncated ? ' · 已截断' : ''}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {NODE_TYPE_META.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleNodeType(item.id)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                  nodeTypes.includes(item.id)
                    ? 'text-white'
                    : 'bg-stone-100 text-stone-400 line-through'
                }`}
                style={nodeTypes.includes(item.id) ? { backgroundColor: item.color } : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {EDGE_TYPE_META.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleEdgeType(item.id)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                  edgeTypes.includes(item.id)
                    ? 'text-white'
                    : 'bg-stone-100 text-stone-400 line-through'
                }`}
                style={edgeTypes.includes(item.id) ? { backgroundColor: item.color } : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            className="overflow-hidden rounded-xl border border-stone-100 bg-[#fffdf8]"
            style={{ height: isCompact ? GRAPH_HEIGHT_COMPACT : GRAPH_HEIGHT }}
          >
            {loading && (
              <p className="flex h-full items-center justify-center text-sm text-stone-500">
                图谱加载中…
              </p>
            )}
            {!loading && error && (
              <p className="flex h-full items-center justify-center text-sm text-cinnabar">{error}</p>
            )}
            {!loading && !error && chartOption && (
              <ReactECharts
                option={chartOption}
                style={{ height: '100%', width: '100%' }}
                onEvents={{
                  click: (params: { dataType?: string; data?: { id?: string } }) => {
                    if (params.dataType === 'node' && params.data?.id) {
                      setSelectedId(params.data.id)
                    }
                  },
                  dblclick: (params: { dataType?: string; data?: { id?: string } }) => {
                    if (params.dataType === 'node' && params.data?.id) {
                      chooseSeed(params.data.id)
                    }
                  },
                }}
              />
            )}
          </div>
          <p className="text-xs text-stone-400">单击查看详情；双击以该节点为新种子展开。</p>
        </section>

        <aside className="rounded-2xl border border-stone-200 bg-white/90 p-4 text-sm">
          <h2 className="mb-2 font-medium text-stone-700">节点详情</h2>
          {!selected && <p className="text-stone-400">点击图中节点查看</p>}
          {selected && (
            <div className="space-y-2">
              <p className="font-serif text-lg font-semibold text-ink">
                {convertScript(selected.label, scriptMode)}
              </p>
              <p className="text-xs text-stone-500">
                {conceptKindLabel(selected)} · <span className="break-all">{selected.id}</span>
              </p>
              {selected.bookId && (
                <p className="text-xs text-stone-500">所属书：{selected.bookId}</p>
              )}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  className="rounded-lg bg-teal px-3 py-2 text-white"
                  onClick={() => chooseSeed(selected.id)}
                >
                  以此为种子展开
                </button>
                {selectedHref && (
                  <Link
                    to={selectedHref}
                    className="rounded-lg border border-stone-200 px-3 py-2 text-center text-teal hover:bg-teal-soft"
                  >
                    <FontAwesomeIcon icon={faUpRightFromSquare} className="mr-1" />
                    打开详情页
                  </Link>
                )}
              </div>
              {graph && (
                <ul className="mt-3 max-h-64 space-y-1 overflow-auto border-t border-stone-100 pt-2 text-xs text-stone-600">
                  {graph.edges
                    .filter((edge) => edge.from === selected.id || edge.to === selected.id)
                    .slice(0, 30)
                    .map((edge) => {
                      const otherId = edge.from === selected.id ? edge.to : edge.from
                      const other = graph.nodes.find((node) => node.id === otherId)
                      return (
                        <li key={edge.id}>
                          <button
                            type="button"
                            className="text-left hover:text-cinnabar"
                            onClick={() => setSelectedId(otherId)}
                          >
                            {edgeLabel(edge.type)} → {other ? convertScript(other.label, scriptMode) : otherId}
                          </button>
                        </li>
                      )
                    })}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
