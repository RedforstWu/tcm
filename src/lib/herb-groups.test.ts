import { describe, expect, it } from 'vitest'
import { herbFilterMatches, herbFilterOptions } from './herb-groups'

const herbs = [
  { id: '芍药', name: '芍药' },
  { id: '白芍', name: '白芍' },
  { id: '黄芪', name: '黄芪' },
  { id: '黄茋', name: '黄茋' },
  { id: '熟地黄', name: '熟地黄' },
  { id: '熟地', name: '熟地' },
  { id: '甘草', name: '甘草' },
  { id: '炙甘草', name: '炙甘草' },
]

describe('herb groups', () => {
  it('合并报告中的三组药名，甘草不并入炙甘草', () => {
    expect(herbFilterOptions(herbs).map((option) => option.label)).toEqual([
      '芍药（白芍）',
      '黄芪（黄茋）',
      '熟地黄（熟地）',
      '甘草',
      '炙甘草',
    ])
    expect(herbFilterMatches(['白芍'], '芍药')).toBe(true)
    expect(herbFilterMatches(['黄茋'], '黄芪')).toBe(true)
    expect(herbFilterMatches(['熟地'], '熟地黄')).toBe(true)
    expect(herbFilterMatches(['炙甘草'], '甘草')).toBe(false)
    expect(herbFilterMatches(['甘草'], '甘草')).toBe(true)
  })
})
