import { describe, expect, it } from 'vitest'
import { buildGraphDataset } from './graph-build.ts'
import type { BookRegistryEntry } from './books-registry.ts'
import type { Clause, Evidence, Formula, Herb } from '../../src/types/data.ts'
import type { Concept } from '../../src/types/ontology.ts'
import type { IntegratedCommentary, IntegratedSyndrome } from './integration-contract.ts'
import { mergeEvidenceFiles } from './integration-merge.ts'

const registry: BookRegistryEntry[] = [
  {
    id: 'songben',
    title: '宋本伤寒论',
    shortName: '宋本',
    fullTitle: '宋本伤寒论',
    corpus: 'jingfang',
    school: 'jingfang',
    author: '张仲景',
    era: '东汉',
    sourceUrl: 'https://example.com',
    parser: 'songben',
    order: 1,
    color: '#0f766e',
    hasClauses: true,
    doseSystem: 'han',
  },
]

const concepts: Concept[] = [
  {
    id: 'symptom.恶寒',
    type: 'symptom',
    prefLabel: '恶寒',
    altLabels: [],
    reviewStatus: 'reviewed',
  },
]

describe('buildGraphDataset', () => {
  it('builds containsClause / citesFormula / hasHerb / mentionsConcept edges', async () => {
    const clauses: Clause[] = [
      {
        id: 'songben-1',
        book: 'songben',
        chapter: '辨太阳病脉证并治',
        chapterOrder: 1,
        order: 1,
        text: '太阳病，发热，汗出，恶寒',
        formulaIds: ['songben-formula-桂枝汤'],
        symptomTags: ['恶寒'],
        pulseTags: [],
        channelTags: ['太阳'],
        pathogenesisTags: [],
        conceptIds: ['symptom.恶寒'],
        reviewStatus: 'ai-draft',
      },
    ]
    const formulas: Formula[] = [
      {
        id: 'songben-formula-桂枝汤',
        name: '桂枝汤',
        book: 'songben',
        herbs: [
          {
            herbId: 'guizhi',
            name: '桂枝',
            rawText: '桂枝三两',
            doseRaw: '三两',
          },
        ],
        preparation: '',
        modifications: [],
        sourceClauseIds: ['songben-1'],
      },
    ]
    const herbs: Herb[] = [
      { id: 'guizhi', name: '桂枝', aliases: [], formulaIds: [formulas[0]!.id], frequency: 1 },
    ]

    const graph = await buildGraphDataset({
      registry,
      clauses,
      formulas,
      herbs,
      monographs: [],
      families: [],
      herbRoles: [],
      crossLinks: [],
      alignments: [],
      parallels: [],
      chenfuReasoning: {
        generatedAt: '',
        source: 'test',
        reviewStatus: 'ai-draft',
        records: [],
        formulas: {},
        compareTopics: [],
        stats: {
          bianzheng: { records: 0, annotated: 0, cases: 0, disputeCounts: { misdiagnosis: 0, mistreatment: 0, drugDoubt: 0, commonPractice: 0, none: 0 } },
          funvke: { records: 0, annotated: 0, cases: 0, disputeCounts: { misdiagnosis: 0, mistreatment: 0, drugDoubt: 0, commonPractice: 0, none: 0 } },
          funanke: { records: 0, annotated: 0, cases: 0, disputeCounts: { misdiagnosis: 0, mistreatment: 0, drugDoubt: 0, commonPractice: 0, none: 0 } },
          shishi: { records: 0, annotated: 0, cases: 0, disputeCounts: { misdiagnosis: 0, mistreatment: 0, drugDoubt: 0, commonPractice: 0, none: 0 } },
        },
      },
      concepts,
    })

    expect(graph.nodes.some((n) => n.id === 'songben-1')).toBe(true)
    expect(graph.edgesByType.containsClause?.length).toBe(1)
    expect(graph.edgesByType.citesFormula?.length).toBe(1)
    expect(graph.edgesByType.hasHerb?.length).toBe(1)
    expect(graph.edgesByType.mentionsConcept?.some((e) => e.to === 'symptom.恶寒')).toBe(true)
    expect(graph.edgesByType.treatsConcept?.some((e) => e.from === 'songben-formula-桂枝汤' && e.to === 'symptom.恶寒')).toBe(true)
  })
})

describe('buildGraphDataset integration', () => {
  const emptyDisputes = { misdiagnosis: 0, mistreatment: 0, drugDoubt: 0, commonPractice: 0, none: 0 }
  const emptyBookStats = { records: 0, annotated: 0, cases: 0, disputeCounts: emptyDisputes }
  const chenfuReasoning = {
    generatedAt: '',
    source: 'test',
    reviewStatus: 'ai-draft' as const,
    records: [],
    formulas: {},
    compareTopics: [],
    stats: { bianzheng: emptyBookStats, funvke: emptyBookStats, funanke: emptyBookStats, shishi: emptyBookStats },
  }
  const clause: Clause = {
    id: 'songben-12',
    book: 'songben',
    chapter: '辨太阳病脉证并治上',
    chapterOrder: 1,
    order: 12,
    text: '太阳中风……桂枝汤主之。',
    formulaIds: ['songben-formula-桂枝汤'],
    symptomTags: [],
    pulseTags: [],
    channelTags: [],
    pathogenesisTags: [],
    reviewStatus: 'ai-draft',
  }
  const formula: Formula = {
    id: 'songben-formula-桂枝汤',
    name: '桂枝汤',
    book: 'songben',
    herbs: [],
    preparation: '',
    modifications: [],
    sourceClauseIds: ['songben-12'],
  }
  const kbEvidence: Evidence = {
    sourceId: 'shanghan-kb@def',
    group: 'derived',
    locator: '01_条文/太阳病/条文-012.md',
    quote: 'KB 原文',
    license: '未声明',
  }
  const commentaries: IntegratedCommentary[] = [
    {
      id: 'commentary-尤怡-012',
      clauseId: 'songben-12',
      commentator: '尤怡',
      sourceBook: '伤寒贯珠集',
      formulaIds: [],
      quotes: [{ text: '此太阳中风之的脉的证也', verified: true }],
      evidence: [kbEvidence],
    },
    {
      id: 'commentary-柯琴-999',
      clauseId: 'songben-999',
      commentator: '柯琴',
      sourceBook: '伤寒来苏集',
      formulaIds: [],
      quotes: [{ text: '原句', verified: true }],
      evidence: [],
    },
  ]
  const syndromes: IntegratedSyndrome[] = [
    {
      conceptId: 'syndrome.太阳中风证',
      prefLabel: '太阳中风证',
      sixChannel: '太阳病',
      clauseIds: ['songben-12', 'songben-12', 'songben-999'],
      mainFormulaIds: ['songben-formula-桂枝汤', 'songben-formula-不存在'],
      mainSymptoms: [],
      differentials: [
        { targetConceptId: 'syndrome.太阳伤寒证', note: '有汗无汗' },
        { targetConceptId: 'syndrome.不存在', note: '' },
      ],
      evidence: [kbEvidence],
    },
    {
      conceptId: 'syndrome.太阳伤寒证',
      prefLabel: '太阳伤寒证',
      sixChannel: '太阳病',
      clauseIds: [],
      mainFormulaIds: [],
      mainSymptoms: [],
      differentials: [],
      evidence: [],
    },
  ]
  const evidence = mergeEvidenceFiles([
    {
      producer: 'test',
      generatedAt: '',
      sourceIds: [],
      records: [
        {
          entityId: 'songben-12',
          entityType: 'clause',
          field: 'formulaLink',
          verdict: 'agree',
          evidence: { sourceId: 'kanripo:KR3e0007@SBCK', group: 'kanripo', locator: 'KR3e0007_SBCK_002-1a', license: 'CC BY-SA 4.0' },
        },
        {
          entityId: 'commentary-尤怡-012',
          entityType: 'commentary',
          field: 'quote',
          verdict: 'agree',
          evidence: { sourceId: 'jobkoko@abc', group: 'web-simplified', locator: 'S-049', quote: '原句', license: '未声明' },
        },
      ],
    },
  ]).byEntity

  const build = (publishUnlicensed: boolean) =>
    buildGraphDataset({
      registry,
      clauses: [clause],
      formulas: [formula],
      herbs: [],
      monographs: [],
      families: [],
      herbRoles: [],
      crossLinks: [],
      alignments: [],
      parallels: [],
      chenfuReasoning,
      concepts,
      integration: { commentaries, syndromes, evidence, gate: { publishUnlicensed } },
    })

  it('注家节点与 commentsOn 边；端点缺失时跳过计数', async () => {
    const graph = await build(false)
    const node = graph.nodes.find((item) => item.id === 'commentary-尤怡-012')
    expect(node).toMatchObject({ type: 'commentary', label: '尤怡·12', bookId: 'songben' })
    expect(graph.nodes.find((item) => item.id === 'commentary-柯琴-999')!.label).toBe('柯琴·999')
    const edges = graph.edgesByType.commentsOn ?? []
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({
      from: 'commentary-尤怡-012',
      to: 'songben-12',
      method: 'rule',
      reviewStatus: 'ai-draft',
      evidenceLevel: 'corroborated',
    })
    expect(edges[0]!.evidence!.every((item) => item.quote === undefined)).toBe(true)
    expect(graph.adjacencyByNodeType.commentary?.['commentary-尤怡-012']).toEqual([edges[0]!.id])
  })

  it('证型边 mentionsConcept / treatsConcept / differentiates，去重并跳过悬空端点', async () => {
    const graph = await build(false)
    const mentions = (graph.edgesByType.mentionsConcept ?? []).filter((edge) => edge.to === 'syndrome.太阳中风证')
    expect(mentions.map((edge) => edge.from)).toEqual(['songben-12'])
    expect(mentions[0]).toMatchObject({ method: 'rule', reviewStatus: 'ai-draft', evidenceLevel: 'single' })
    expect(mentions[0]!.evidence).toEqual([
      { sourceId: 'shanghan-kb@def', group: 'derived', locator: '01_条文/太阳病/条文-012.md', license: '未声明' },
    ])
    const treats = (graph.edgesByType.treatsConcept ?? []).filter((edge) => edge.to === 'syndrome.太阳中风证')
    expect(treats.map((edge) => edge.from)).toEqual(['songben-formula-桂枝汤'])
    const differentiates = graph.edgesByType.differentiates ?? []
    expect(differentiates.map((edge) => edge.to)).toEqual(['syndrome.太阳伤寒证'])
    expect(differentiates[0]!.attributes).toBeUndefined()
    expect(graph.nodes.find((item) => item.id === 'syndrome.太阳伤寒证')).toMatchObject({ type: 'concept' })
    // commentsOn 1 + mentionsConcept 1 + treatsConcept 1 + differentiates 1
    expect(graph.stats.skippedEdgeCount).toBe(4)
    expect(graph.stats.skippedEdgeCountsByType).toEqual({
      commentsOn: 1,
      mentionsConcept: 1,
      treatsConcept: 1,
      differentiates: 1,
    })
  })

  it('flag 模式才写入鉴别要点 note', async () => {
    const graph = await build(true)
    expect(graph.edgesByType.differentiates?.[0]!.attributes).toEqual({ note: '有汗无汗' })
    expect(graph.edgesByType.mentionsConcept?.find((edge) => edge.to === 'syndrome.太阳中风证')!.evidence![0]!.quote).toBe(
      'KB 原文',
    )
  })

  it('citesFormula 边附 formulaLink 证据', async () => {
    const graph = await build(false)
    const [edge] = graph.edgesByType.citesFormula ?? []
    expect(edge).toMatchObject({ evidenceLevel: 'corroborated' })
    expect(edge!.evidence).toEqual([
      {
        sourceId: 'kanripo:KR3e0007@SBCK',
        group: 'kanripo',
        locator: 'KR3e0007_SBCK_002-1a',
        license: 'CC BY-SA 4.0',
        field: 'formulaLink',
        verdict: 'agree',
      },
    ])
  })

  it('未传 integration 时不产生整合节点与边', async () => {
    const graph = await buildGraphDataset({
      registry,
      clauses: [clause],
      formulas: [formula],
      herbs: [],
      monographs: [],
      families: [],
      herbRoles: [],
      crossLinks: [],
      alignments: [],
      parallels: [],
      chenfuReasoning,
      concepts,
    })
    expect(graph.nodes.some((item) => item.type === 'commentary')).toBe(false)
    expect(graph.edgesByType.citesFormula?.[0]!.evidence).toBeUndefined()
    expect(graph.stats.skippedEdgeCount).toBe(0)
  })
})
