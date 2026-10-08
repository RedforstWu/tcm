import { describe, expect, it } from 'vitest'
import {
  computeNatureIndex,
  normalizeFormulaName,
  resolveFormulaId,
  splitFormulaNames,
  validateTree,
  type FormulaReasoningInput,
  type ReasoningTreeInput,
} from './reasoning.ts'

const guizhiHerbs: FormulaReasoningInput['herbs'] = [
  { name: '桂枝', weight: 3, natures: ['热', '补', '散', '燥'], action: '' },
  { name: '芍药', weight: 3, natures: ['寒', '补', '收', '润'], action: '' },
  { name: '炙甘草', weight: 2, natures: ['补', '收', '润'], action: '' },
  { name: '生姜', weight: 3, natures: ['热', '补', '升', '散', '燥'], action: '' },
  { name: '大枣', weight: 6, natures: ['热', '补', '降', '收', '润'], action: '' },
]

describe('computeNatureIndex', () => {
  it('matches 桂枝汤 lecture indices', () => {
    const index = computeNatureIndex(guizhiHerbs)
    expect(index.热).toBeCloseTo(0.705882352941, 10)
    expect(index.寒).toBeCloseTo(0.176470588235, 10)
    expect(index.补).toBeCloseTo(1.0, 10)
    expect(index.泻).toBeCloseTo(0.0, 10)
    expect(index.升).toBeCloseTo(0.176470588235, 10)
    expect(index.降).toBeCloseTo(0.352941176471, 10)
    expect(index.收).toBeCloseTo(0.647058823529, 10)
    expect(index.散).toBeCloseTo(0.352941176471, 10)
    expect(index.润).toBeCloseTo(0.647058823529, 10)
    expect(index.燥).toBeCloseTo(0.352941176471, 10)
  })
})

describe('validateTree', () => {
  const validTree: ReasoningTreeInput = {
    id: 'demo',
    title: 'demo',
    sourcePage: 1,
    rootNodeId: 'root',
    nodes: {
      root: {
        question: 'q1',
        options: [
          { label: 'a', nextNodeId: 'leaf' },
          { label: 'b', result: { formulaName: '桂枝汤' } },
        ],
      },
      leaf: {
        question: 'q2',
        options: [{ label: 'c', result: { formulaName: '葛根汤' } }],
      },
    },
  }

  it('accepts a valid tree', () => {
    expect(validateTree(validTree)).toEqual([])
  })

  it('rejects option without next or result', () => {
    const tree: ReasoningTreeInput = {
      ...validTree,
      nodes: {
        root: {
          question: 'q',
          options: [{ label: 'broken' }],
        },
      },
    }
    const errors = validateTree(tree)
    expect(errors.some((error) => error.includes('须恰好指定'))).toBe(true)
  })

  it('rejects dangling nextNodeId', () => {
    const tree: ReasoningTreeInput = {
      ...validTree,
      nodes: {
        root: {
          question: 'q',
          options: [{ label: 'x', nextNodeId: 'missing' }],
        },
      },
    }
    const errors = validateTree(tree)
    expect(errors.some((error) => error.includes('不存在的节点'))).toBe(true)
  })

  it('rejects cycles', () => {
    const tree: ReasoningTreeInput = {
      id: 'cycle',
      title: 'cycle',
      sourcePage: 1,
      rootNodeId: 'a',
      nodes: {
        a: { question: 'a', options: [{ label: 'to-b', nextNodeId: 'b' }] },
        b: { question: 'b', options: [{ label: 'to-a', nextNodeId: 'a' }] },
      },
    }
    const errors = validateTree(tree)
    expect(errors.some((error) => error.includes('存在环'))).toBe(true)
  })
})

describe('formula name resolution', () => {
  it('normalizes aliases', () => {
    expect(normalizeFormulaName('麻杏甘石汤')).toBe('麻黄杏仁甘草石膏汤')
    expect(normalizeFormulaName('苓桂朮甘汤')).toBe('苓桂术甘汤')
    expect(normalizeFormulaName('八味地黄丸')).toBe('肾气丸')
  })

  it('splits combined formulas', () => {
    expect(splitFormulaNames('五苓散+平胃散')).toEqual(['五苓散', '平胃散'])
  })

  it('resolves by book priority', () => {
    const formulas = [
      { id: 'guilin-formula-桂枝汤', name: '桂枝汤', book: 'guilin' as const },
      { id: 'songben-formula-桂枝汤', name: '桂枝汤', book: 'songben' as const },
      { id: 'jingui-formula-苓桂术甘汤', name: '苓桂术甘汤', book: 'jingui' as const },
      {
        id: 'songben-formula-麻黄杏仁甘草石膏汤',
        name: '麻黄杏仁甘草石膏汤',
        book: 'songben' as const,
      },
    ]
    expect(resolveFormulaId('桂枝汤', formulas)).toBe('songben-formula-桂枝汤')
    expect(resolveFormulaId('麻杏甘石汤', formulas)).toBe('songben-formula-麻黄杏仁甘草石膏汤')
    expect(resolveFormulaId('苓桂朮甘汤', formulas)).toBe('jingui-formula-苓桂术甘汤')
    expect(resolveFormulaId('平胃散', formulas)).toBeUndefined()
  })
})
