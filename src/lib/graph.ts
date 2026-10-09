import type { EdgeType, GraphEdge, GraphNode, NodeType } from '@/types/graph'
import type { Concept } from '@/types/ontology'
import { clauseHref } from '@/lib/integration'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return response.json() as Promise<T>
}

let cache: {
  concepts?: Concept[]
  nodes?: GraphNode[]
  edges: Partial<Record<EdgeType, GraphEdge[]>>
  adjacency: Partial<Record<NodeType, Record<string, string[]>>>
  edgeIndex?: Map<string, GraphEdge>
  nodeIndex?: Map<string, GraphNode>
} = { edges: {}, adjacency: {} }

export async function loadConcepts(): Promise<Concept[]> {
  cache.concepts ??= await fetchJson<Concept[]>('/data/concepts.json')
  return cache.concepts
}

export async function loadGraphNodes(): Promise<GraphNode[]> {
  cache.nodes ??= await fetchJson<GraphNode[]>('/data/graph/nodes.json')
  cache.nodeIndex = new Map(cache.nodes.map((node) => [node.id, node]))
  return cache.nodes
}

export async function loadEdges(type: EdgeType): Promise<GraphEdge[]> {
  if (!cache.edges[type]) {
    try {
      cache.edges[type] = await fetchJson<GraphEdge[]>(`/data/graph/edges-${type}.json`)
    } catch {
      cache.edges[type] = []
    }
  }
  return cache.edges[type]!
}

export async function loadAdjacency(nodeType: NodeType): Promise<Record<string, string[]>> {
  if (!cache.adjacency[nodeType]) {
    try {
      cache.adjacency[nodeType] = await fetchJson(`/data/graph/adjacency-${nodeType}.json`)
    } catch {
      cache.adjacency[nodeType] = {}
    }
  }
  return cache.adjacency[nodeType]!
}

async function ensureEdgeIndex(types: EdgeType[]): Promise<Map<string, GraphEdge>> {
  const lists = await Promise.all(types.map((type) => loadEdges(type)))
  const map = cache.edgeIndex ?? new Map<string, GraphEdge>()
  for (const edges of lists) {
    for (const edge of edges) map.set(edge.id, edge)
  }
  cache.edgeIndex = map
  return map
}

export async function getConcept(conceptId: string): Promise<Concept | undefined> {
  const concepts = await loadConcepts()
  return concepts.find((item) => item.id === conceptId)
}

export async function neighbors(
  nodeId: string,
  edgeTypes: EdgeType[],
  nodeTypeHint?: NodeType,
): Promise<Array<{ edge: GraphEdge; node: GraphNode }>> {
  await loadGraphNodes()
  const edgeIndex = await ensureEdgeIndex(edgeTypes)
  const allowed = new Set(edgeTypes)

  let edgeIds: string[] = []
  if (nodeTypeHint) {
    const adj = await loadAdjacency(nodeTypeHint)
    edgeIds = adj[nodeId] ?? []
  } else {
    for (const type of ['clause', 'formula', 'herb', 'concept', 'case', 'book', 'monograph', 'commentary'] as NodeType[]) {
      const adj = await loadAdjacency(type)
      if (adj[nodeId]) edgeIds.push(...adj[nodeId])
    }
  }

  const results: Array<{ edge: GraphEdge; node: GraphNode }> = []
  for (const edgeId of edgeIds) {
    const edge = edgeIndex.get(edgeId)
    if (!edge || !allowed.has(edge.type)) continue
    const otherId = edge.from === nodeId ? edge.to : edge.from
    const node = cache.nodeIndex?.get(otherId)
    if (!node) continue
    results.push({ edge, node })
  }
  return results
}

/** 按边终点查找（概念页：谁 mentions 了该概念） */
export async function incoming(
  nodeId: string,
  edgeTypes: EdgeType[],
): Promise<Array<{ edge: GraphEdge; node: GraphNode }>> {
  await loadGraphNodes()
  const results: Array<{ edge: GraphEdge; node: GraphNode }> = []
  for (const type of edgeTypes) {
    const edges = await loadEdges(type)
    for (const edge of edges) {
      if (edge.to !== nodeId) continue
      const node = cache.nodeIndex?.get(edge.from)
      if (!node) continue
      results.push({ edge, node })
    }
  }
  return results
}

/** 不分方向查找相邻边（证型鉴别：differentiates 可能双向记录） */
export async function incident(
  nodeId: string,
  edgeTypes: EdgeType[],
): Promise<Array<{ edge: GraphEdge; node: GraphNode }>> {
  await loadGraphNodes()
  const results: Array<{ edge: GraphEdge; node: GraphNode }> = []
  for (const type of edgeTypes) {
    const edges = await loadEdges(type)
    for (const edge of edges) {
      if (edge.from !== nodeId && edge.to !== nodeId) continue
      const node = cache.nodeIndex?.get(edge.from === nodeId ? edge.to : edge.from)
      if (!node) continue
      results.push({ edge, node })
    }
  }
  return results
}

/** 按 id 批量取图谱节点；不存在的 id 不出现在结果中 */
export async function lookupGraphNodes(ids: string[]): Promise<Map<string, GraphNode>> {
  await loadGraphNodes()
  const found = new Map<string, GraphNode>()
  for (const id of ids) {
    const node = cache.nodeIndex?.get(id)
    if (node) found.set(id, node)
  }
  return found
}

export interface NeighborhoodOptions {
  edgeTypes: EdgeType[]
  /** 允许保留的节点类型；缺省全部 */
  nodeTypes?: NodeType[]
  depth?: number
  maxNodes?: number
}

export interface NeighborhoodGraph {
  seedId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
}

/** 从种子节点双向展开邻域（BFS），控制深度与规模以免全图卡死 */
export async function expandNeighborhood(
  seedId: string,
  options: NeighborhoodOptions,
): Promise<NeighborhoodGraph> {
  const nodes = await loadGraphNodes()
  const nodeIndex = cache.nodeIndex ?? new Map(nodes.map((node) => [node.id, node]))
  const seed = nodeIndex.get(seedId)
  if (!seed) {
    return { seedId, nodes: [], edges: [], truncated: false }
  }

  const depth = Math.max(1, Math.min(options.depth ?? 1, 3))
  const maxNodes = options.maxNodes ?? 80
  const allowedNodeTypes = options.nodeTypes ? new Set(options.nodeTypes) : null
  const edgeLists = await Promise.all(options.edgeTypes.map((type) => loadEdges(type)))
  const allEdges = edgeLists.flat()

  const byEndpoint = new Map<string, GraphEdge[]>()
  for (const edge of allEdges) {
    const fromList = byEndpoint.get(edge.from) ?? []
    fromList.push(edge)
    byEndpoint.set(edge.from, fromList)
    const toList = byEndpoint.get(edge.to) ?? []
    toList.push(edge)
    byEndpoint.set(edge.to, toList)
  }

  const keptNodes = new Map<string, GraphNode>([[seed.id, seed]])
  const keptEdges = new Map<string, GraphEdge>()
  let frontier = [seed.id]
  let truncated = false

  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = []
    for (const nodeId of frontier) {
      const incident = byEndpoint.get(nodeId) ?? []
      for (const edge of incident) {
        const otherId = edge.from === nodeId ? edge.to : edge.from
        const other = nodeIndex.get(otherId)
        if (!other) continue
        if (allowedNodeTypes && !allowedNodeTypes.has(other.type) && otherId !== seedId) {
          continue
        }
        if (!keptNodes.has(otherId)) {
          if (keptNodes.size >= maxNodes) {
            truncated = true
            continue
          }
          keptNodes.set(otherId, other)
          next.push(otherId)
        }
        if (keptNodes.has(edge.from) && keptNodes.has(edge.to)) {
          keptEdges.set(edge.id, edge)
        }
      }
    }
    frontier = next
    if (truncated) break
  }

  // 补全已选节点之间的边
  for (const edge of allEdges) {
    if (keptNodes.has(edge.from) && keptNodes.has(edge.to)) {
      keptEdges.set(edge.id, edge)
    }
  }

  return {
    seedId,
    nodes: [...keptNodes.values()],
    edges: [...keptEdges.values()],
    truncated,
  }
}

export function searchGraphNodes(
  nodes: GraphNode[],
  query: string,
  limit = 20,
): GraphNode[] {
  const q = query.trim()
  if (!q) return []
  const scored = nodes
    .map((node) => {
      if (node.id === q) return { node, score: 0 }
      if (node.label === q) return { node, score: 1 }
      if (node.label.includes(q) || node.id.includes(q)) return { node, score: 2 }
      return null
    })
    .filter(Boolean) as Array<{ node: GraphNode; score: number }>
  return scored
    .sort((a, b) => a.score - b.score || a.node.label.localeCompare(b.node.label, 'zh'))
    .slice(0, limit)
    .map((item) => item.node)
}

export function hrefForGraphNode(node: GraphNode): string | null {
  switch (node.type) {
    case 'book':
      return `/read/${node.id}`
    case 'clause':
      return node.bookId
        ? `/read/${node.bookId}?clause=${encodeURIComponent(node.id)}`
        : null
    case 'formula':
      return `/formulas/${encodeURIComponent(node.id)}`
    case 'herb':
      return `/herbs/${encodeURIComponent(node.id)}`
    case 'concept':
      return `/concept/${encodeURIComponent(node.id)}`
    case 'case':
      return '/reasoning'
    case 'monograph':
      return node.attributes && typeof node.attributes.herbId === 'string'
        ? `/herbs/${encodeURIComponent(node.attributes.herbId)}`
        : '/herbs'
    case 'commentary': {
      const clauseId = node.attributes?.clauseId
      if (typeof clauseId !== 'string' || !clauseId) return null
      return clauseHref(clauseId, node.bookId)
    }
    default:
      return null
  }
}
