import { describe, expect, it } from 'vitest'
import type { Formula } from '../../src/types/data.ts'
import { computeDiffPairs, computeFamilies } from './relations.ts'

function formula(name: string, herbs: string[]): Formula {
  return {
    id: `f-${name}`,
    name,
    book: 'songben',
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

describe('relations', () => {
  it('detects single-herb add/remove pairs', () => {
    const guizhi = formula('桂枝汤', ['桂枝', '芍药', '甘草', '生姜', '大枣'])
    const quShaoyao = formula('桂枝去芍药汤', ['桂枝', '甘草', '生姜', '大枣'])
    const pairs = computeDiffPairs([guizhi, quShaoyao], [])
    expect(pairs.some((pair) => pair.kind === 'remove' && pair.herbName === '芍药')).toBe(true)
  })

  it('clusters formula families by naming', () => {
    const formulas = [
      formula('桂枝汤', ['桂枝', '芍药', '甘草', '生姜', '大枣']),
      formula('桂枝加附子汤', ['桂枝', '芍药', '甘草', '生姜', '大枣', '附子']),
      formula('桂枝去芍药汤', ['桂枝', '甘草', '生姜', '大枣']),
    ]
    const families = computeFamilies(formulas)
    expect(families.some((family) => family.name.includes('桂枝汤'))).toBe(true)
  })
})
