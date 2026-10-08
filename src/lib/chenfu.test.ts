import { describe, expect, it } from 'vitest'
import type { CaseDispute, ChenfuRecord } from '@/types/data'
import {
  caseTitle,
  disputeKindsOfCase,
  flattenRecords,
  routeDisputes,
  symptomDisplay,
} from './chenfu'

const disputes: CaseDispute[] = [
  { kind: 'misdiagnosis', claim: '人以为肺寒', rebuttal: '谁知肾虚' },
  { kind: 'mistreatment', claim: '倘认作寒', rebuttal: '必致变症' },
  { kind: 'drugDoubt', claim: '或疑熟地太多', rebuttal: '不知非此不能' },
  { kind: 'commonPractice', claim: '世人但知清肺', rebuttal: '不知补肾' },
]

describe('routeDisputes', () => {
  it('按类别分入辨误、治法、方药三栏', () => {
    const routed = routeDisputes(disputes)
    expect(routed.diagnosis.map((item) => item.kind)).toEqual(['misdiagnosis', 'commonPractice'])
    expect(routed.treatment.map((item) => item.kind)).toEqual(['mistreatment'])
    expect(routed.formula.map((item) => item.kind)).toEqual(['drugDoubt'])
  })

  it('空数组时三栏皆空', () => {
    expect(routeDisputes([])).toEqual({ diagnosis: [], treatment: [], formula: [] })
  })
})

describe('symptomDisplay', () => {
  it('原文症状直接显示', () => {
    expect(symptomDisplay({ symptomText: '人有咳嗽', symptomSource: 'text' }, {})).toEqual({
      text: '人有咳嗽',
    })
  })

  it('以标题为症时附说明', () => {
    expect(symptomDisplay({ symptomSource: 'heading' }, { heading: '大满' })).toMatchObject({
      text: '大满',
      note: '原文以标题为症',
    })
  })

  it('承接上一则时给出链接条文', () => {
    expect(
      symptomDisplay({ symptomSource: 'previous', continuesFromClauseId: 'bianzheng-0360' }, {}),
    ).toMatchObject({ linkClauseId: 'bianzheng-0360' })
  })

  it('原文未述症状', () => {
    expect(symptomDisplay({ symptomSource: 'none' }, {}).text).toBe('原文未述症状')
  })
})

describe('flattenRecords', () => {
  const base: Omit<ChenfuRecord, 'clauseId' | 'cases' | 'annotated'> = {
    book: 'bianzheng',
    chapter: '卷之四·咳嗽门',
    symptomTags: [],
    pathogenesisTags: [],
    parallelIds: [],
  }

  it('多病案展开为多项，未标注条文保留一项', () => {
    const records: ChenfuRecord[] = [
      {
        ...base,
        clauseId: 'bianzheng-0001',
        annotated: true,
        cases: [
          { caseId: 'bianzheng-0001#0', caseIndex: 0, symptomSource: 'text', disputes: [], organs: [], relations: [], elements: [], formulaIds: [] },
          { caseId: 'bianzheng-0001#1', caseIndex: 1, symptomSource: 'text', disputes: [], organs: [], relations: [], elements: [], formulaIds: [] },
        ],
      },
      { ...base, clauseId: 'bianzheng-0002', annotated: false, cases: [] },
    ]
    expect(flattenRecords(records).map((item) => item.key)).toEqual([
      'bianzheng-0001#0',
      'bianzheng-0001#1',
      'bianzheng-0002',
    ])
  })
})

describe('disputeKindsOfCase / caseTitle', () => {
  it('无辩难归为直述证治', () => {
    expect([...disputeKindsOfCase({ disputes: [] })]).toEqual(['none'])
    expect(disputeKindsOfCase({ disputes }).has('drugDoubt')).toBe(true)
  })

  it('标题按长度截断', () => {
    expect(caseTitle({ symptomText: '一二三四五', symptomSource: 'text' }, {}, 3)).toBe('一二三…')
    expect(caseTitle({ symptomText: '一二三', symptomSource: 'text' }, {}, 3)).toBe('一二三')
  })
})
