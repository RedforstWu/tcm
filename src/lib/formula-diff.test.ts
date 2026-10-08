import { describe, expect, it } from 'vitest'
import type { Formula } from '@/types/data'
import {
  buildFamilyRelations,
  compareFormulas,
  resolveFamilyRoot,
} from './formula-diff'

function formula(id: string, name: string, book: Formula['book'], herbs: string[]): Formula {
  return {
    id,
    name,
    book,
    herbs: herbs.map((herb) => ({
      herbId: herb,
      name: herb,
      rawText: `${herb}三两`,
      doseRaw: '三两',
      doseLiang: 3,
    })),
    preparation: '',
    modifications: [],
    sourceClauseIds: [],
  }
}

describe('formula-diff', () => {
  it('compares single add from root', () => {
    const root = formula('s-gz', '桂枝汤', 'songben', ['桂枝', '芍药', '甘草', '生姜', '大枣'])
    const child = formula('s-gz-fz', '桂枝加附子汤', 'songben', [
      '桂枝',
      '芍药',
      '甘草',
      '生姜',
      '大枣',
      '附子',
    ])
    const rel = compareFormulas(root, child)
    expect(rel?.kind).toBe('add')
    expect(rel?.label).toContain('附子')
  })

  it('builds star edges from songben root including guilin', () => {
    const members = [
      formula('s-gz', '桂枝汤', 'songben', ['桂枝', '芍药', '甘草', '生姜', '大枣']),
      formula('g-gz', '桂枝汤', 'guilin', ['桂枝', '芍药', '甘草', '生姜', '大枣']),
      formula('g-fz', '桂枝加附子汤', 'guilin', [
        '桂枝',
        '芍药',
        '甘草',
        '生姜',
        '大枣',
        '附子',
      ]),
      formula('s-fz', '桂枝加附子汤', 'songben', [
        '桂枝',
        '芍药',
        '甘草',
        '生姜',
        '大枣',
        '附子',
      ]),
    ]
    const root = resolveFamilyRoot(members, 's-gz')
    expect(root?.id).toBe('s-gz')
    const relations = buildFamilyRelations(members, 's-gz')
    expect(relations.some((item) => item.toId === 'g-fz')).toBe(true)
    expect(relations.some((item) => item.toId === 'g-gz')).toBe(true)
    expect(relations.every((item) => item.fromId === 's-gz' || item.fromId !== item.toId)).toBe(
      true,
    )
  })

  it('labels multi-herb diffs', () => {
    const a = formula('a', '甲', 'songben', ['桂枝', '芍药', '甘草'])
    const b = formula('b', '乙', 'guilin', ['桂枝', '生姜', '大枣'])
    const rel = compareFormulas(a, b)
    expect(rel?.kind).toBe('multi')
    expect(rel?.added).toHaveLength(2)
    expect(rel?.removed).toHaveLength(2)
  })
})
