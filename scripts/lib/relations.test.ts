import { describe, expect, it } from 'vitest'
import type { Formula } from '../../src/types/data.ts'
import { computeDiffPairs, computeFamilies, extractFamilyBaseName } from './relations.ts'

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
    const guizhi = families.find((family) => family.name === '桂枝汤类')
    expect(guizhi?.formulaIds).toHaveLength(3)
  })

  it('extracts family base name with 汤 suffix', () => {
    expect(extractFamilyBaseName('桂枝加附子汤')).toBe('桂枝汤')
    expect(extractFamilyBaseName('四逆加人参汤')).toBe('四逆汤')
    expect(extractFamilyBaseName('桂枝汤')).toBe('桂枝汤')
  })

  it('compares songben with guilin and multi-herb diffs', () => {
    const song = formula('桂枝汤', ['桂枝', '芍药', '甘草', '生姜', '大枣'])
    const gui: Formula = {
      ...formula('桂枝加葛根汤', ['桂枝', '芍药', '甘草', '生姜', '大枣', '葛根']),
      id: 'g-桂枝加葛根汤',
      book: 'guilin',
    }
    const pairs = computeDiffPairs([song, gui], [])
    expect(pairs.some((pair) => pair.kind === 'add' && pair.herbName === '葛根')).toBe(true)

    const multi = formula('甲', ['桂枝', '芍药', '甘草'])
    const multiB: Formula = {
      ...formula('乙', ['桂枝', '生姜', '大枣']),
      id: 'g-乙',
      book: 'guilin',
    }
    const multiPairs = computeDiffPairs([multi, multiB], [])
    expect(multiPairs.some((pair) => pair.kind === 'multi')).toBe(true)
  })
})
