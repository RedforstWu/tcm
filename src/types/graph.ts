import type { Evidence, EvidenceLevel, ReviewStatus } from './data'
import type { Concept } from './ontology'

export type NodeType =
  | 'book'
  | 'clause'
  | 'formula'
  | 'herb'
  | 'monograph'
  | 'case'
  | 'concept'
  | 'commentary'

export type EdgeType =
  | 'containsClause'
  | 'citesFormula'
  | 'hasHerb'
  | 'derivedFrom'
  | 'familyOf'
  | 'parallel'
  | 'aligned'
  | 'herbRole'
  | 'mentionsConcept'
  | 'treatsConcept'
  | 'crossLink'
  | 'organRelation'
  | 'prerequisite'
  | 'commentsOn'
  | 'differentiates'

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  bookId?: string
  attributes?: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  type: EdgeType
  from: string
  to: string
  sourceClauseId?: string
  school?: string
  method: 'rule' | 'llm' | 'manual'
  reviewStatus: ReviewStatus
  attributes?: Record<string, unknown>
  evidence?: Evidence[]
  evidenceLevel?: EvidenceLevel
}

export interface GraphDataset {
  nodes: GraphNode[]
  edgesByType: Partial<Record<EdgeType, GraphEdge[]>>
  adjacencyByNodeType: Partial<Record<NodeType, Record<string, string[]>>>
  concepts: Concept[]
  stats: {
    nodeCount: number
    edgeCount: number
    edgeCounts: Partial<Record<EdgeType, number>>
    skippedEdgeCount?: number
    /** 因端点不存在而跳过的边，按边类型计数 */
    skippedEdgeCountsByType?: Partial<Record<EdgeType, number>>
  }
}
