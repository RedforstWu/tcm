import { describe, expect, it } from 'vitest'
import type { Clause, Formula } from '../../src/types/data.ts'
import {
  buildChenfuReasoningDataset,
  caseIdOf,
  clauseReasoningHash,
  elementsOfCase,
  mergeOrphanPrescriptions,
  resolveSymptomSource,
  type ChenfuCacheFile,
  type CompareTopicInput,
} from './chenfu-reasoning-build.ts'
import type { ChenfuCase } from './chenfu-reasoning-validate.ts'

function makeClause(overrides: Partial<Clause>): Clause {
  return {
    id: 'bianzheng-0001',
    book: 'bianzheng',
    chapter: '卷之四·咳嗽门',
    chapterOrder: 1,
    order: 1,
    text: '人有咳嗽，人以为肺寒也，谁知是肾水不足乎。方用润肺汤。',
    formulaIds: [],
    symptomTags: ['咳嗽'],
    pulseTags: [],
    channelTags: [],
    pathogenesisTags: ['肾虚'],
    reviewStatus: 'ai-draft',
    heading: '咳嗽门·第1则',
    ...overrides,
  } as Clause
}

function makeFormula(overrides: Partial<Formula>): Formula {
  return {
    id: 'bianzheng-formula-bianzheng-0001-1',
    name: '润肺汤',
    book: 'bianzheng',
    herbs: [],
    preparation: '麦冬（一两）熟地（一两）',
    modifications: [],
    sourceClauseIds: ['bianzheng-0001'],
    fangjie: '此方补肾以生肺金。',
    ...overrides,
  } as Formula
}

function makeCase(overrides: Partial<ChenfuCase>): ChenfuCase {
  return {
    caseIndex: 0,
    symptomText: '人有咳嗽',
    disputes: [{ kind: 'misdiagnosis', claim: '人以为肺寒也', rebuttal: '谁知是肾水不足乎' }],
    organs: ['肺', '肾'],
    relations: [{ from: '肾', to: '肺', kind: '生' }],
    formulaIds: ['bianzheng-formula-bianzheng-0001-1'],
    ...overrides,
  }
}

const TOPICS: CompareTopicInput[] = [
  {
    id: 'cough',
    title: '咳嗽',
    jingfang: { treeId: 'fever-cough-tree', formulaNames: ['小青龙汤', '麻杏甘石汤', '不存在方'] },
    chenfu: [{ book: 'bianzheng', headingPattern: '咳嗽门' }],
  },
]

const JINGFANG_FORMULAS = [
  { id: 'songben-formula-小青龙汤', name: '小青龙汤', book: 'songben' },
  { id: 'songben-formula-麻黄杏仁甘草石膏汤', name: '麻黄杏仁甘草石膏汤', book: 'songben' },
] as Formula[]

describe('elementsOfCase', () => {
  it('脏腑映射为去重的五行', () => {
    expect(elementsOfCase({ organs: ['肝', '胆', '命门', '心'] })).toEqual(['木', '火'])
  })

  it('无脏腑时返回空数组', () => {
    expect(elementsOfCase({ organs: [] })).toEqual([])
  })
})

describe('resolveSymptomSource', () => {
  it('有原文症状时取原文', () => {
    expect(
      resolveSymptomSource({ caseIndex: 0, symptomText: '人有咳嗽' }, { book: 'bianzheng' }, 'x'),
    ).toEqual({ symptomSource: 'text' })
  })

  it('男科缺症状时以标题为症', () => {
    expect(
      resolveSymptomSource({ caseIndex: 0 }, { book: 'funanke', heading: '大满' }, undefined),
    ).toEqual({ symptomSource: 'heading' })
  })

  it('辨证录首个病案缺症状时承接同门上一则', () => {
    expect(
      resolveSymptomSource({ caseIndex: 0 }, { book: 'bianzheng', heading: '中毒门·第2则' }, 'bianzheng-0360'),
    ).toEqual({ symptomSource: 'previous', continuesFromClauseId: 'bianzheng-0360' })
  })

  it('无上一则或非首个病案时标记为未述症状', () => {
    expect(resolveSymptomSource({ caseIndex: 0 }, { book: 'bianzheng' }, undefined)).toEqual({
      symptomSource: 'none',
    })
    expect(resolveSymptomSource({ caseIndex: 1 }, { book: 'shishi', heading: '天师曰' }, 'p')).toEqual({
      symptomSource: 'none',
    })
  })
})

describe('buildChenfuReasoningDataset', () => {
  const clause = makeClause({})
  const formula = makeFormula({})
  const hash = clauseReasoningHash(clause, [formula])
  const cache: ChenfuCacheFile = {
    book: 'bianzheng',
    reviewStatus: 'ai-draft',
    entries: [{ clauseId: clause.id, contentHash: hash, cases: [makeCase({})] }],
  }

  it('哈希一致时补全病案 ID、五行与方剂', () => {
    const dataset = buildChenfuReasoningDataset({
      clauses: [clause],
      formulas: [formula, ...JINGFANG_FORMULAS],
      caches: [cache],
      parallels: [{ leftId: 'funvke-0001', rightId: clause.id }],
      compareTopics: TOPICS,
      reasoningFormulaNames: ['小青龙汤', '麻杏甘石汤'],
    })
    const record = dataset.records[0]
    expect(record.annotated).toBe(true)
    expect(record.cases[0].caseId).toBe(caseIdOf(clause.id, 0))
    expect(record.cases[0].elements).toEqual(['金', '水'])
    expect(record.parallelIds).toEqual(['funvke-0001'])
    expect(dataset.formulas[formula.id]?.fangjie).toBe('此方补肾以生肺金。')
    expect(dataset.stats.bianzheng).toMatchObject({ records: 1, annotated: 1, cases: 1 })
    expect(dataset.stats.bianzheng.disputeCounts.misdiagnosis).toBe(1)
  })

  it('原文变更（哈希不一致）时标记为待标注', () => {
    const dataset = buildChenfuReasoningDataset({
      clauses: [makeClause({ text: `${clause.text}补` })],
      formulas: [formula],
      caches: [cache],
      parallels: [],
      compareTopics: [],
      reasoningFormulaNames: [],
    })
    expect(dataset.records[0].annotated).toBe(false)
    expect(dataset.records[0].cases).toEqual([])
  })

  it('非陈傅书籍的条文不进入数据集', () => {
    const dataset = buildChenfuReasoningDataset({
      clauses: [makeClause({ id: 'songben-1', book: 'songben' })],
      formulas: [],
      caches: [],
      parallels: [],
      compareTopics: [],
      reasoningFormulaNames: [],
    })
    expect(dataset.records).toEqual([])
  })

  it('对照专题解析方剂与病案', () => {
    const dataset = buildChenfuReasoningDataset({
      clauses: [clause],
      formulas: [formula, ...JINGFANG_FORMULAS],
      caches: [cache],
      parallels: [],
      compareTopics: TOPICS,
      reasoningFormulaNames: ['小青龙汤', '麻杏甘石汤'],
    })
    const topic = dataset.compareTopics[0]
    expect(topic.chenfuCaseIds).toEqual([caseIdOf(clause.id, 0)])
    expect(topic.jingfang.formulas).toEqual([
      { name: '小青龙汤', formulaId: 'songben-formula-小青龙汤', hasReasoning: true },
      { name: '麻杏甘石汤', formulaId: 'songben-formula-麻黄杏仁甘草石膏汤', hasReasoning: true },
      { name: '不存在方', formulaId: undefined, hasReasoning: false },
    ])
  })

  it('casePattern 只保留文字命中的病案', () => {
    const twoCases: ChenfuCacheFile = {
      ...cache,
      entries: [
        {
          clauseId: clause.id,
          contentHash: hash,
          cases: [
            makeCase({ caseIndex: 0, symptomText: '太阳之症' }),
            makeCase({ caseIndex: 1, symptomText: '阳明之症', disputes: [] }),
          ],
        },
      ],
    }
    const dataset = buildChenfuReasoningDataset({
      clauses: [clause],
      formulas: [formula],
      caches: [twoCases],
      parallels: [],
      compareTopics: [
        { ...TOPICS[0], chenfu: [{ book: 'bianzheng', headingPattern: '咳嗽', casePattern: '阳明' }] },
      ],
      reasoningFormulaNames: [],
    })
    expect(dataset.compareTopics[0].chenfuCaseIds).toEqual([caseIdOf(clause.id, 1)])
    expect(dataset.stats.bianzheng.disputeCounts.none).toBe(1)
  })

  it('切分错位时把下一则首案的方药并入上一则末案', () => {
    const clauseA = makeClause({ id: 'bianzheng-0001', text: '人有咳嗽，人以为肺寒也，谁知是肾水不足乎。' })
    const clauseB = makeClause({ id: 'bianzheng-0002', text: '方用润肺汤。此方补肾以生肺金。人有久嗽。', order: 2 })
    const formulaB = makeFormula({ id: 'bianzheng-formula-bianzheng-0002-1', sourceClauseIds: ['bianzheng-0002'] })
    const caches: ChenfuCacheFile[] = [
      {
        book: 'bianzheng',
        reviewStatus: 'ai-draft',
        entries: [
          {
            clauseId: clauseA.id,
            contentHash: clauseReasoningHash(clauseA, []),
            cases: [makeCase({ formulaIds: [], relations: [] })],
          },
          {
            clauseId: clauseB.id,
            contentHash: clauseReasoningHash(clauseB, [formulaB]),
            cases: [
              makeCase({
                caseIndex: 0,
                symptomText: undefined,
                disputes: [{ kind: 'drugDoubt', claim: '或疑', rebuttal: '不知' }],
                organs: ['肾'],
                relations: [],
                formulaIds: [formulaB.id],
                keySentence: '此方补肾以生肺金。',
              }),
              makeCase({ caseIndex: 1, symptomText: '人有久嗽', disputes: [], formulaIds: [] }),
            ],
          },
        ],
      },
    ]
    const dataset = buildChenfuReasoningDataset({
      clauses: [clauseA, clauseB],
      formulas: [formulaB],
      caches,
      parallels: [],
      compareTopics: [],
      reasoningFormulaNames: [],
    })
    const [recordA, recordB] = dataset.records
    expect(recordA.cases).toHaveLength(1)
    expect(recordA.cases[0]).toMatchObject({
      formulaIds: [formulaB.id],
      keySentence: '此方补肾以生肺金。',
      prescriptionFromClauseId: clauseB.id,
    })
    expect(recordA.cases[0].disputes.map((item) => item.kind)).toEqual(['misdiagnosis', 'drugDoubt'])
    expect(recordB.cases.map((item) => item.caseId)).toEqual([caseIdOf(clauseB.id, 1)])
    expect(dataset.stats.bianzheng.cases).toBe(2)
  })

  it('上一则末案已有方时不合并', () => {
    const records = [
      {
        clauseId: 'a',
        book: 'bianzheng' as const,
        chapter: 'c',
        symptomTags: [],
        pathogenesisTags: [],
        annotated: true,
        parallelIds: [],
        cases: [{ ...makeCase({}), caseId: 'a#0', elements: [], symptomSource: 'text' as const }],
      },
      {
        clauseId: 'b',
        book: 'bianzheng' as const,
        chapter: 'c',
        symptomTags: [],
        pathogenesisTags: [],
        annotated: true,
        parallelIds: [],
        cases: [
          {
            ...makeCase({ symptomText: undefined }),
            caseId: 'b#0',
            elements: [],
            symptomSource: 'previous' as const,
            continuesFromClauseId: 'a',
          },
        ],
      },
    ]
    expect(mergeOrphanPrescriptions(records)).toBe(0)
    expect(records[1].cases).toHaveLength(1)
  })

  it('专题 id 重复或正则无效时抛错', () => {
    const base = {
      clauses: [],
      formulas: [],
      caches: [],
      parallels: [],
      reasoningFormulaNames: [],
    }
    expect(() =>
      buildChenfuReasoningDataset({ ...base, compareTopics: [TOPICS[0], TOPICS[0]] }),
    ).toThrow(/重复/)
    expect(() =>
      buildChenfuReasoningDataset({
        ...base,
        compareTopics: [{ ...TOPICS[0], chenfu: [{ book: 'bianzheng', headingPattern: '(' }] }],
      }),
    ).toThrow(/正则无效/)
  })
})
