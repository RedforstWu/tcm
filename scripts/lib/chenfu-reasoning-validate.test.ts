import { describe, expect, it } from 'vitest'
import {
  countDisputeKinds,
  isSubstringOf,
  validateCase,
  validateEntry,
  type ValidationInput,
} from './chenfu-reasoning-validate.ts'

const input: ValidationInput = {
  clauseId: 'bianzheng-0001',
  contentHash: 'hash-1',
  book: 'bianzheng',
  chapter: '卷之一·伤寒门',
  text:
    '冬月伤寒，发热头痛，汗出口渴，人以为太阳之症也，谁知太阳已趋入阳明乎。法宜正治阳明而兼治少阳也。\n\n' +
    '冬月伤寒，发热口苦，人以为太阳之症也，谁知少阳之病乎。肺欺胆木之虚，即移其邪于少阳。倘认是阳症变阴，纯用温热之剂。',
  formulas: [
    { formulaId: 'f-1', fangjie: '用石膏、知母以泻其阳明之火邪；用柴胡、栀子以断其少阳之路径。' },
    { formulaId: 'f-2', fangjie: '' },
  ],
}

describe('isSubstringOf', () => {
  it('ignores whitespace and full-width spaces', () => {
    expect(isSubstringOf('发热 头痛', '冬月伤寒，发热头痛')).toBe(true)
    expect(isSubstringOf('发热\u3000头痛', '冬月伤寒，发热\n头痛')).toBe(true)
  })

  it('keeps punctuation significant', () => {
    expect(isSubstringOf('发热。头痛', '冬月伤寒，发热头痛')).toBe(false)
  })

  it('rejects empty fragment', () => {
    expect(isSubstringOf('  ', 'abc')).toBe(false)
  })
})

describe('validateCase', () => {
  it('accepts a full valid case', () => {
    const { caseItem, rejects } = validateCase(
      {
        caseIndex: 0,
        symptomText: '冬月伤寒，发热头痛，汗出口渴',
        disputes: [{ kind: 'misdiagnosis', claim: '太阳之症也', rebuttal: '太阳已趋入阳明乎' }],
        pathogenesis: '太阳已趋入阳明乎',
        organs: ['胃'],
        relations: [],
        treatmentPrinciple: '法宜正治阳明而兼治少阳也',
        formulaIds: ['f-1'],
        keySentence: '用石膏、知母以泻其阳明之火邪',
      },
      input,
    )
    expect(rejects).toEqual([])
    expect(caseItem?.disputes).toHaveLength(1)
    expect(caseItem?.keySentence).toBe('用石膏、知母以泻其阳明之火邪')
  })

  it('accepts an empty disputes array as 直述证治', () => {
    const { caseItem, rejects } = validateCase(
      { caseIndex: 0, symptomText: '冬月伤寒，发热口苦', disputes: [], formulaIds: [] },
      input,
    )
    expect(rejects).toEqual([])
    expect(caseItem?.disputes).toEqual([])
  })

  it('drops invalid dispute kind and non-substring rebuttal', () => {
    const { caseItem, rejects } = validateCase(
      {
        caseIndex: 1,
        symptomText: '冬月伤寒，发热口苦',
        disputes: [
          { kind: 'other', claim: '太阳之症也', rebuttal: '少阳之病乎' },
          { kind: 'misdiagnosis', claim: '太阳之症也', rebuttal: '编造的论断' },
          { kind: 'mistreatment', claim: '倘认是阳症变阴', rebuttal: '纯用温热之剂' },
        ],
      },
      input,
    )
    expect(caseItem?.disputes).toEqual([
      { kind: 'mistreatment', claim: '倘认是阳症变阴', rebuttal: '纯用温热之剂' },
    ])
    expect(rejects.some((reason) => reason.includes('kind invalid'))).toBe(true)
    expect(rejects.some((reason) => reason.includes('rebuttal not substring'))).toBe(true)
  })

  it('rejects illegal organs, relations, and foreign formula ids', () => {
    const { caseItem, rejects } = validateCase(
      {
        caseIndex: 1,
        symptomText: '冬月伤寒，发热口苦',
        organs: ['胆', '脑'],
        relations: [
          { from: '肺', to: '胆', kind: '移邪' },
          { from: '肺', to: '胆', kind: '相生' },
          { from: '肝', to: '肝', kind: '克' },
        ],
        formulaIds: ['f-1', 'other-formula'],
      },
      input,
    )
    expect(caseItem?.organs).toEqual(['胆', '肺'])
    expect(caseItem?.relations).toEqual([{ from: '肺', to: '胆', kind: '移邪' }])
    expect(caseItem?.formulaIds).toEqual(['f-1'])
    expect(rejects.some((reason) => reason.includes('organ invalid: 脑'))).toBe(true)
    expect(rejects.some((reason) => reason.includes('relation invalid'))).toBe(true)
    expect(rejects.some((reason) => reason.includes('self-loop'))).toBe(true)
    expect(rejects.some((reason) => reason.includes('formulaId not in clause'))).toBe(true)
  })

  it('rejects keySentence when primary formula has no fangjie', () => {
    const { caseItem, rejects } = validateCase(
      { caseIndex: 0, symptomText: '冬月伤寒', formulaIds: ['f-2'], keySentence: '任意' },
      input,
    )
    expect(caseItem?.keySentence).toBeUndefined()
    expect(rejects.some((reason) => reason.includes('without fangjie'))).toBe(true)
  })

  it('only allows methodCategory for shishi and within chapter', () => {
    const notShishi = validateCase(
      { caseIndex: 0, symptomText: '冬月伤寒', methodCategory: '正医法' },
      input,
    )
    expect(notShishi.caseItem?.methodCategory).toBeUndefined()

    const shishiInput: ValidationInput = { ...input, book: 'shishi', chapter: '正医法' }
    expect(
      validateCase({ caseIndex: 0, symptomText: '冬月伤寒', methodCategory: '正医法' }, shishiInput)
        .caseItem?.methodCategory,
    ).toBe('正医法')
    expect(
      validateCase({ caseIndex: 0, symptomText: '冬月伤寒', methodCategory: '反医法' }, shishiInput)
        .rejects.some((reason) => reason.includes('not in chapter')),
    ).toBe(true)
  })

  it('drops the whole case when symptomText is not a substring and nothing else is left', () => {
    const { caseItem } = validateCase({ caseIndex: 0, symptomText: '夏月中暑' }, input)
    expect(caseItem).toBeNull()
  })

  it('keeps a case without symptomText when it has pathogenesis or formula', () => {
    const { caseItem, rejects } = validateCase(
      {
        caseIndex: 0,
        disputes: [],
        pathogenesis: '肺欺胆木之虚，即移其邪于少阳',
        formulaIds: ['f-1'],
      },
      input,
    )
    expect(rejects).toEqual([])
    expect(caseItem?.symptomText).toBeUndefined()
    expect(caseItem?.formulaIds).toEqual(['f-1'])
  })

  it('drops a non-substring symptomText but keeps the rest of the case', () => {
    const { caseItem, rejects } = validateCase(
      { caseIndex: 0, symptomText: '夏月中暑', formulaIds: ['f-1'] },
      input,
    )
    expect(caseItem?.symptomText).toBeUndefined()
    expect(rejects.some((reason) => reason.includes('symptomText not substring'))).toBe(true)
  })
})

describe('validateEntry', () => {
  it('splits a multi-case record and renumbers caseIndex', () => {
    const result = validateEntry(
      {
        clauseId: 'bianzheng-0001',
        contentHash: 'hash-1',
        cases: [
          { caseIndex: 3, symptomText: '冬月伤寒，发热口苦', disputes: [] },
          { caseIndex: 1, symptomText: '冬月伤寒，发热头痛，汗出口渴', disputes: [] },
          { caseIndex: 2, symptomText: '不存在的叙述' },
        ],
      },
      input,
    )
    expect(result.hardReject).toBe(false)
    expect(result.cases.map((caseItem) => caseItem.symptomText)).toEqual([
      '冬月伤寒，发热头痛，汗出口渴',
      '冬月伤寒，发热口苦',
    ])
    expect(result.cases.map((caseItem) => caseItem.caseIndex)).toEqual([0, 1])
  })

  it('hard-rejects on hash mismatch or missing input', () => {
    expect(validateEntry({ clauseId: 'x', contentHash: 'bad', cases: [] }, input).hardReject).toBe(true)
    expect(validateEntry({ clauseId: 'x', contentHash: 'hash-1', cases: [] }, undefined).hardReject).toBe(
      true,
    )
  })
})

describe('countDisputeKinds', () => {
  it('counts each kind and cases without disputes', () => {
    const counts = countDisputeKinds([
      {
        caseIndex: 0,
        symptomText: 'a',
        disputes: [
          { kind: 'misdiagnosis', claim: 'x', rebuttal: 'y' },
          { kind: 'drugDoubt', claim: 'x', rebuttal: 'y' },
        ],
        organs: [],
        relations: [],
        formulaIds: [],
      },
      { caseIndex: 1, symptomText: 'b', disputes: [], organs: [], relations: [], formulaIds: [] },
    ])
    expect(counts).toEqual({
      misdiagnosis: 1,
      mistreatment: 0,
      drugDoubt: 1,
      commonPractice: 0,
      none: 1,
    })
  })
})
