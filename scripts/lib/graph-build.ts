import path from 'node:path'
import type {
  AlignmentRecord,
  ChenfuReasoningDataset,
  Clause,
  CrossLink,
  Formula,
  FormulaFamily,
  Herb,
  HerbMonograph,
  HerbRole,
  ParallelAlignment,
} from '../../src/types/data.ts'
import type { Evidence, EvidenceLevel } from '../../src/types/data.ts'
import type { EdgeType, GraphDataset, GraphEdge, GraphNode, NodeType } from '../../src/types/graph.ts'
import type { Concept } from '../../src/types/ontology.ts'
import type { BookRegistryEntry } from './books-registry.ts'
import { loadConceptLexicon } from './concept-lexicon.ts'
import { makeConceptId } from './concept-id.ts'
import { fileExists, projectRoot, readText } from './fs-utils.ts'
import type { IntegratedCommentary, IntegratedSyndrome } from './integration-contract.ts'
import {
  classifyFieldLevel,
  dedupeEvidence,
  gateEvidence,
  recordToEvidence,
  type MergedEntityEvidence,
  type PublishGate,
} from './integration-merge.ts'

interface CurriculumFile {
  prerequisites?: Array<{
    id: string
    fromFormulaName: string
    toFormulaName: string
    reason?: string
  }>
}

export interface GraphBuildInput {
  registry: BookRegistryEntry[]
  clauses: Clause[]
  formulas: Formula[]
  herbs: Herb[]
  monographs: HerbMonograph[]
  families: FormulaFamily[]
  herbRoles: HerbRole[]
  crossLinks: CrossLink[]
  alignments: AlignmentRecord[]
  parallels: ParallelAlignment[]
  chenfuReasoning: ChenfuReasoningDataset
  concepts?: Concept[]
  integration?: GraphIntegrationInput
}

/** 外部来源整合结果；commentaries / syndromes 须已过许可闸门 */
export interface GraphIntegrationInput {
  commentaries: IntegratedCommentary[]
  syndromes: IntegratedSyndrome[]
  evidence: ReadonlyMap<string, MergedEntityEvidence>
  gate: PublishGate
}

/** 既有边的悬空数超过此值视为数据异常而中止构建（整合边的跳过不计入） */
const MAX_DANGLING_BASE_EDGES = 500

function edgeId(type: EdgeType, from: string, to: string, extra = ''): string {
  return `${type}:${from}->${to}${extra ? `:${extra}` : ''}`
}

interface SkippedEdge {
  type: EdgeType
  message: string
}

function pushEdge(
  edgesByType: Partial<Record<EdgeType, GraphEdge[]>>,
  edge: GraphEdge,
  nodeIds: Set<string>,
  skipped: SkippedEdge[],
): void {
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
    skipped.push({ type: edge.type, message: `dangling edge ${edge.id} (${edge.from} -> ${edge.to})` })
    return
  }
  const list = edgesByType[edge.type] ?? []
  list.push(edge)
  edgesByType[edge.type] = list
}

export async function buildGraphDataset(input: GraphBuildInput): Promise<GraphDataset> {
  const concepts =
    input.concepts ??
    (await loadConceptLexicon(projectRoot())).concepts

  const nodes: GraphNode[] = []
  const nodeIds = new Set<string>()
  const nodeTypeById = new Map<string, NodeType>()
  const addNode = (node: GraphNode) => {
    if (nodeIds.has(node.id)) return
    nodeIds.add(node.id)
    nodeTypeById.set(node.id, node.type)
    nodes.push(node)
  }

  for (const book of input.registry) {
    addNode({ id: book.id, type: 'book', label: book.title })
  }
  for (const clause of input.clauses) {
    addNode({
      id: clause.id,
      type: 'clause',
      label: clause.heading ?? `${clause.chapter}#${clause.order}`,
      bookId: clause.book,
    })
  }
  for (const formula of input.formulas) {
    addNode({
      id: formula.id,
      type: 'formula',
      label: formula.name,
      bookId: formula.book,
    })
  }
  for (const herb of input.herbs) {
    addNode({ id: herb.id, type: 'herb', label: herb.name })
  }
  // 方剂药味中未入药材总表的名称也建 herb 节点，避免 hasHerb 悬空
  for (const formula of input.formulas) {
    for (const herb of formula.herbs) {
      if (!herb.herbId) continue
      if (!nodeIds.has(herb.herbId)) {
        addNode({ id: herb.herbId, type: 'herb', label: herb.name || herb.herbId })
      }
    }
  }
  for (const mono of input.monographs) {
    addNode({
      id: mono.id,
      type: 'monograph',
      label: mono.name,
      bookId: mono.sourceBook,
    })
  }
  for (const concept of concepts) {
    addNode({ id: concept.id, type: 'concept', label: concept.prefLabel })
  }
  for (const record of input.chenfuReasoning.records) {
    for (const caseItem of record.cases) {
      addNode({
        id: caseItem.caseId,
        type: 'case',
        label: caseItem.keySentence?.slice(0, 24) || caseItem.caseId,
        bookId: record.book,
      })
    }
  }

  // 确保 mentions 引用的概念节点存在
  for (const clause of input.clauses) {
    for (const conceptId of clause.conceptIds ?? []) {
      if (!nodeIds.has(conceptId)) {
        const label = conceptId.includes('.') ? conceptId.split('.').slice(1).join('.') : conceptId
        addNode({ id: conceptId, type: 'concept', label })
      }
    }
  }

  const edgesByType: Partial<Record<EdgeType, GraphEdge[]>> = {}
  const skipped: SkippedEdge[] = []
  const schoolByBook = new Map(input.registry.map((book) => [book.id, book.school]))
  const integration = input.integration

  const sourceClauseIdsByFormula = new Map(
    input.formulas.map((formula) => [formula.id, new Set(formula.sourceClauseIds)]),
  )
  /**
   * 条文引方边的证据：field=formulaLink 的记录。挂在条文上的记录适用于该条全部引方边；
   * 挂在方剂上的记录只适用于其 sourceClauseIds 中的条文。
   */
  const formulaLinkEvidence = (
    clauseId: string,
    formulaId: string,
  ): Pick<GraphEdge, 'evidence' | 'evidenceLevel'> => {
    if (!integration) return {}
    const linkRecords = (entityId: string) =>
      integration.evidence.get(entityId)?.records.filter((record) => record.field === 'formulaLink') ?? []
    const records = [
      ...linkRecords(clauseId),
      ...(sourceClauseIdsByFormula.get(formulaId)?.has(clauseId) ? linkRecords(formulaId) : []),
    ]
    if (records.length === 0) return {}
    return {
      evidence: dedupeEvidence(records.map((record) => recordToEvidence(record, integration.gate))),
      evidenceLevel: classifyFieldLevel(records),
    }
  }

  for (const clause of input.clauses) {
    const school = schoolByBook.get(clause.book)
    pushEdge(
      edgesByType,
      {
        id: edgeId('containsClause', clause.book, clause.id),
        type: 'containsClause',
        from: clause.book,
        to: clause.id,
        method: 'rule',
        reviewStatus: 'reviewed',
        school,
      },
      nodeIds,
      skipped,
    )
    for (const formulaId of clause.formulaIds) {
      pushEdge(
        edgesByType,
        {
          id: edgeId('citesFormula', clause.id, formulaId),
          type: 'citesFormula',
          from: clause.id,
          to: formulaId,
          sourceClauseId: clause.id,
          method: 'rule',
          reviewStatus: clause.reviewStatus,
          school,
          ...formulaLinkEvidence(clause.id, formulaId),
        },
        nodeIds,
        skipped,
      )
    }
    for (const conceptId of clause.conceptIds ?? []) {
      if (!nodeIds.has(conceptId)) continue
      pushEdge(
        edgesByType,
        {
          id: edgeId('mentionsConcept', clause.id, conceptId),
          type: 'mentionsConcept',
          from: clause.id,
          to: conceptId,
          sourceClauseId: clause.id,
          method: 'rule',
          reviewStatus: clause.reviewStatus,
          school,
        },
        nodeIds,
        skipped,
      )
      // 方剂主治概念：仅主方（首个 formulaId）↔ 症状/病机，避免多方×多标签爆炸
      if (conceptId.startsWith('symptom.') || conceptId.startsWith('pathogenesis.')) {
        const mainFormulaId = clause.formulaIds[0]
        if (mainFormulaId) {
          pushEdge(
            edgesByType,
            {
              id: edgeId('treatsConcept', mainFormulaId, conceptId, clause.id),
              type: 'treatsConcept',
              from: mainFormulaId,
              to: conceptId,
              sourceClauseId: clause.id,
              method: 'rule',
              reviewStatus: clause.reviewStatus,
              school,
            },
            nodeIds,
            skipped,
          )
        }
      }
    }
  }

  for (const formula of input.formulas) {
    for (const herb of formula.herbs) {
      pushEdge(
        edgesByType,
        {
          id: edgeId('hasHerb', formula.id, herb.herbId),
          type: 'hasHerb',
          from: formula.id,
          to: herb.herbId,
          method: 'rule',
          reviewStatus: 'reviewed',
          attributes: {
            doseRaw: herb.doseRaw,
            doseQian: herb.doseQian,
            processing: herb.processing,
          },
        },
        nodeIds,
        skipped,
      )
    }
    for (const derived of formula.derivedFrom ?? []) {
      if (!derived.formulaId) continue
      pushEdge(
        edgesByType,
        {
          id: edgeId('derivedFrom', formula.id, derived.formulaId),
          type: 'derivedFrom',
          from: formula.id,
          to: derived.formulaId,
          method: 'rule',
          reviewStatus: 'ai-draft',
          attributes: { name: derived.name },
        },
        nodeIds,
        skipped,
      )
    }
    if (formula.familyId) {
      // family 作为属性边：formula -> base（用 familyOf 连家族成员到 base）
      const family = input.families.find((item) => item.id === formula.familyId)
      if (family && family.baseFormulaId !== formula.id) {
        pushEdge(
          edgesByType,
          {
            id: edgeId('familyOf', formula.id, family.baseFormulaId),
            type: 'familyOf',
            from: formula.id,
            to: family.baseFormulaId,
            method: 'rule',
            reviewStatus: 'ai-draft',
            attributes: { familyId: family.id, familyName: family.name },
          },
          nodeIds,
          skipped,
        )
      }
    }
  }

  for (const role of input.herbRoles) {
    pushEdge(
      edgesByType,
      {
        id: edgeId('herbRole', role.formulaId, role.herbId, role.id),
        type: 'herbRole',
        from: role.formulaId,
        to: role.herbId,
        method: role.method,
        reviewStatus: role.reviewStatus,
        attributes: {
          roleText: role.roleText,
          mechanism: role.mechanism,
          sourceSentence: role.sourceSentence,
        },
      },
      nodeIds,
      skipped,
    )
  }

  for (const link of input.crossLinks) {
    if (!link.jingfangFormulaId) continue
    pushEdge(
      edgesByType,
      {
        id: edgeId('crossLink', link.chenfuFormulaId, link.jingfangFormulaId),
        type: 'crossLink',
        from: link.chenfuFormulaId,
        to: link.jingfangFormulaId,
        method: 'rule',
        reviewStatus: 'ai-draft',
        attributes: { derivedName: link.derivedName, sourceSentence: link.sourceSentence },
      },
      nodeIds,
      skipped,
    )
  }

  for (const align of input.alignments) {
    if (!align.guilinId) continue
    pushEdge(
      edgesByType,
      {
        id: edgeId('aligned', align.songbenId, align.guilinId),
        type: 'aligned',
        from: align.songbenId,
        to: align.guilinId,
        method: 'rule',
        reviewStatus: 'ai-draft',
        attributes: { score: align.score },
      },
      nodeIds,
      skipped,
    )
  }

  for (const parallel of input.parallels) {
    if (!parallel.rightId) continue
    pushEdge(
      edgesByType,
      {
        id: edgeId('parallel', parallel.leftId, parallel.rightId),
        type: 'parallel',
        from: parallel.leftId,
        to: parallel.rightId,
        method: 'rule',
        reviewStatus: 'ai-draft',
        attributes: { score: parallel.score },
      },
      nodeIds,
      skipped,
    )
  }

  for (const record of input.chenfuReasoning.records) {
    for (const caseItem of record.cases) {
      for (const formulaId of caseItem.formulaIds) {
        pushEdge(
          edgesByType,
          {
            id: edgeId('citesFormula', caseItem.caseId, formulaId),
            type: 'citesFormula',
            from: caseItem.caseId,
            to: formulaId,
            sourceClauseId: record.clauseId,
            school: 'chenfu',
            method: 'llm',
            reviewStatus: 'ai-draft',
          },
          nodeIds,
          skipped,
        )
      }
      for (const relation of caseItem.relations) {
        const fromId = makeConceptId('organ', relation.from)
        const toId = makeConceptId('organ', relation.to)
        if (!nodeIds.has(fromId)) addNode({ id: fromId, type: 'concept', label: relation.from })
        if (!nodeIds.has(toId)) addNode({ id: toId, type: 'concept', label: relation.to })
        pushEdge(
          edgesByType,
          {
            id: edgeId('organRelation', fromId, toId, `${caseItem.caseId}:${relation.kind}`),
            type: 'organRelation',
            from: fromId,
            to: toId,
            sourceClauseId: record.clauseId,
            school: 'chenfu',
            method: 'llm',
            reviewStatus: 'ai-draft',
            attributes: { kind: relation.kind, caseId: caseItem.caseId },
          },
          nodeIds,
          skipped,
        )
      }
      for (const organ of caseItem.organs) {
        const conceptId = makeConceptId('organ', organ)
        if (!nodeIds.has(conceptId)) addNode({ id: conceptId, type: 'concept', label: organ })
        pushEdge(
          edgesByType,
          {
            id: edgeId('mentionsConcept', caseItem.caseId, conceptId),
            type: 'mentionsConcept',
            from: caseItem.caseId,
            to: conceptId,
            sourceClauseId: record.clauseId,
            school: 'chenfu',
            method: 'llm',
            reviewStatus: 'ai-draft',
          },
          nodeIds,
          skipped,
        )
      }
    }
  }

  // curriculum prerequisites（方名 → 方剂节点；优先同书，其次宋本）
  const curriculumFile = path.join(projectRoot(), 'data', 'ontology', 'curriculum.json')
  if (await fileExists(curriculumFile)) {
    const curriculum = JSON.parse(await readText(curriculumFile)) as CurriculumFile
    const formulasByName = new Map<string, Formula[]>()
    for (const formula of input.formulas) {
      const list = formulasByName.get(formula.name) ?? []
      list.push(formula)
      formulasByName.set(formula.name, list)
    }
    const pickPreferred = (name: string): Formula | undefined => {
      const list = formulasByName.get(name) ?? []
      return (
        list.find((item) => item.book === 'songben') ??
        list.find((item) => item.book === 'jingui') ??
        list[0]
      )
    }
    for (const prereq of curriculum.prerequisites ?? []) {
      const from = pickPreferred(prereq.fromFormulaName)
      const to = pickPreferred(prereq.toFormulaName)
      if (!from || !to) continue
      pushEdge(
        edgesByType,
        {
          id: edgeId('prerequisite', from.id, to.id, prereq.id),
          type: 'prerequisite',
          from: from.id,
          to: to.id,
          method: 'manual',
          reviewStatus: 'reviewed',
          attributes: { reason: prereq.reason, curriculumId: prereq.id },
        },
        nodeIds,
        skipped,
      )
    }
  }

  if (skipped.length > MAX_DANGLING_BASE_EDGES) {
    const sample = skipped
      .slice(0, 20)
      .map((item) => item.message)
      .join('\n')
    throw new Error(`graph-build too many dangling edges (${skipped.length}):\n${sample}`)
  }

  // 外部来源整合：注家、证型（输入已过许可闸门）；悬空端点跳过并计数，不中止构建
  const integrationSkipped: SkippedEdge[] = []
  if (integration) {
    const { gate } = integration
    const clauseById = new Map(input.clauses.map((clause) => [clause.id, clause]))
    const formulaById = new Map(input.formulas.map((formula) => [formula.id, formula]))
    const existingEdgeIds = new Set(
      Object.values(edgesByType).flatMap((edges) => (edges ?? []).map((edge) => edge.id)),
    )
    const pushIntegrationEdge = (edge: GraphEdge) => {
      if (existingEdgeIds.has(edge.id)) return
      existingEdgeIds.add(edge.id)
      pushEdge(edgesByType, edge, nodeIds, integrationSkipped)
    }
    const entityEvidence = (
      entityId: string,
      base: readonly Evidence[],
    ): { evidence: Evidence[]; evidenceLevel: EvidenceLevel } => {
      const merged = integration.evidence.get(entityId)
      return {
        evidence: dedupeEvidence([
          ...base.map((item) => gateEvidence(item, gate)),
          ...(merged?.records.map((record) => recordToEvidence(record, gate)) ?? []),
        ]),
        evidenceLevel: merged?.level ?? 'single',
      }
    }

    for (const commentary of integration.commentaries) {
      const clause = clauseById.get(commentary.clauseId)
      const clauseNumber = clause ? String(clause.order) : (commentary.id.split('-').pop() ?? '')
      addNode({
        id: commentary.id,
        type: 'commentary',
        label: `${commentary.commentator}·${clauseNumber}`,
        ...(clause ? { bookId: clause.book } : {}),
        attributes: {
          clauseId: commentary.clauseId,
          commentator: commentary.commentator,
          sourceBook: commentary.sourceBook,
          quoteCount: commentary.quotes.length,
        },
      })
      const quoteEvidence = commentary.quotes.flatMap((quote) => (quote.evidence ? [quote.evidence] : []))
      pushIntegrationEdge({
        id: edgeId('commentsOn', commentary.id, commentary.clauseId),
        type: 'commentsOn',
        from: commentary.id,
        to: commentary.clauseId,
        sourceClauseId: commentary.clauseId,
        method: 'rule',
        reviewStatus: 'ai-draft',
        ...entityEvidence(commentary.id, [...commentary.evidence, ...quoteEvidence]),
      })
    }

    for (const syndrome of integration.syndromes) {
      addNode({ id: syndrome.conceptId, type: 'concept', label: syndrome.prefLabel })
    }
    for (const syndrome of integration.syndromes) {
      const shared = entityEvidence(syndrome.conceptId, syndrome.evidence)
      for (const clauseId of syndrome.clauseIds) {
        const clause = clauseById.get(clauseId)
        pushIntegrationEdge({
          id: edgeId('mentionsConcept', clauseId, syndrome.conceptId),
          type: 'mentionsConcept',
          from: clauseId,
          to: syndrome.conceptId,
          sourceClauseId: clauseId,
          ...(clause ? { school: schoolByBook.get(clause.book) } : {}),
          method: 'rule',
          reviewStatus: 'ai-draft',
          ...shared,
        })
      }
      for (const formulaId of syndrome.mainFormulaIds) {
        const formula = formulaById.get(formulaId)
        pushIntegrationEdge({
          id: edgeId('treatsConcept', formulaId, syndrome.conceptId),
          type: 'treatsConcept',
          from: formulaId,
          to: syndrome.conceptId,
          ...(formula ? { school: schoolByBook.get(formula.book) } : {}),
          method: 'rule',
          reviewStatus: 'ai-draft',
          ...shared,
        })
      }
      for (const differential of syndrome.differentials) {
        if (differential.targetConceptId === syndrome.conceptId) continue
        pushIntegrationEdge({
          id: edgeId('differentiates', syndrome.conceptId, differential.targetConceptId),
          type: 'differentiates',
          from: syndrome.conceptId,
          to: differential.targetConceptId,
          method: 'rule',
          reviewStatus: 'ai-draft',
          ...(gate.publishUnlicensed && differential.note ? { attributes: { note: differential.note } } : {}),
          ...shared,
        })
      }
    }
  }
  const allSkipped = [...skipped, ...integrationSkipped]
  const skippedEdgeCountsByType: Partial<Record<EdgeType, number>> = {}
  for (const item of allSkipped) {
    skippedEdgeCountsByType[item.type] = (skippedEdgeCountsByType[item.type] ?? 0) + 1
  }

  const adjacencyByNodeType: Partial<Record<NodeType, Record<string, string[]>>> = {}
  const edgeCounts: Partial<Record<EdgeType, number>> = {}
  let edgeCount = 0
  for (const [type, edges] of Object.entries(edgesByType) as Array<[EdgeType, GraphEdge[]]>) {
    edgeCounts[type] = edges.length
    edgeCount += edges.length
    for (const edge of edges) {
      const fromType = nodeTypeById.get(edge.from)
      if (!fromType) continue
      const bucket = adjacencyByNodeType[fromType] ?? {}
      const list = bucket[edge.from] ?? []
      list.push(edge.id)
      bucket[edge.from] = list
      adjacencyByNodeType[fromType] = bucket
    }
  }

  return {
    nodes,
    edgesByType,
    adjacencyByNodeType,
    concepts,
    stats: {
      nodeCount: nodes.length,
      edgeCount,
      edgeCounts,
      skippedEdgeCount: allSkipped.length,
      skippedEdgeCountsByType,
    },
  }
}
