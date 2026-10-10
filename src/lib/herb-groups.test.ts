import { describe, expect, it } from 'vitest'
import { herbFilterMatches, herbFilterOptions, herbIndexEntries, isProcessingHerbName } from './herb-groups'

const herbs = [
  { id: '芍药', name: '芍药', frequency: 10, formulaIds: ['a'] },
  { id: '白芍', name: '白芍', frequency: 4, formulaIds: ['b'] },
  { id: '白芍药', name: '白芍药', frequency: 1, formulaIds: ['b'] },
  { id: '黄芪', name: '黄芪', frequency: 3, formulaIds: ['c'] },
  { id: '黄茋', name: '黄茋', frequency: 2, formulaIds: ['d'] },
  { id: '熟地黄', name: '熟地黄', frequency: 5, formulaIds: ['e'] },
  { id: '熟地', name: '熟地', frequency: 1, formulaIds: ['e'] },
  { id: '地黄', name: '地黄', frequency: 2, formulaIds: ['f'] },
  { id: '生地', name: '生地', frequency: 1, formulaIds: ['g'] },
  { id: '生地黄', name: '生地黄', frequency: 1, formulaIds: ['g'] },
  { id: '甘草', name: '甘草', frequency: 8, formulaIds: ['h'] },
  { id: '生甘草', name: '生甘草', frequency: 2, formulaIds: ['i'] },
  { id: '炙草', name: '炙草', frequency: 1, formulaIds: ['j'] },
  { id: '炙甘草', name: '炙甘草', frequency: 3, formulaIds: ['j'] },
  { id: '酒炒', name: '酒炒', frequency: 68, formulaIds: ['k'] },
]

describe('herb groups', () => {
  it('合并复测点名的别名，甘草不并入炙甘草，并滤掉酒炒', () => {
    expect(herbFilterOptions(herbs).map((option) => option.label)).toEqual([
      '芍药（白芍、白芍药）',
      '黄芪（黄茋）',
      '熟地黄（熟地）',
      '地黄（生地、生地黄）',
      '甘草',
      '生甘草',
      '炙甘草（炙草）',
      '酒炒',
    ])
    expect(herbIndexEntries(herbs).map((entry) => entry.label)).not.toContain('酒炒')
    expect(herbIndexEntries(herbs).find((entry) => entry.id === '芍药')).toMatchObject({
      frequency: 15,
      formulaCount: 2,
    })
    expect(isProcessingHerbName('酒炒')).toBe(true)
    expect(herbFilterMatches(['白芍药'], '芍药')).toBe(true)
    expect(herbFilterMatches(['生地黄'], '地黄')).toBe(true)
    expect(herbFilterMatches(['炙草'], '炙甘草')).toBe(true)
    expect(herbFilterMatches(['炙甘草'], '甘草')).toBe(false)
    expect(herbFilterMatches(['生甘草'], '甘草')).toBe(false)
  })
})
