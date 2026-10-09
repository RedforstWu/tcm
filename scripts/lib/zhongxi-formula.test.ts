import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeParenDoseFormulas } from './generic-wiki-parse.ts'
import { extractZhongxiSectionFormulas } from './zhongxi-formula.ts'

describe('extractZhongxiSectionFormulas', () => {
  it('fills 【建瓴汤】 and derived 三鲜饮 / 滋阴清燥汤 from raw', () => {
    const raw = readFileSync(path.join(process.cwd(), 'data/raw/zhongxi-canxi.wiki'), 'utf8')
    const blocks = extractZhongxiSectionFormulas(raw)
    const merged = mergeParenDoseFormulas([], blocks, 'zhongxi')

    expect(merged.find((f) => f.name === '建瓴汤')?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['生怀山药', '怀牛膝', '生赭石']),
    )
    expect(merged.find((f) => f.name === '三鲜饮')?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['鲜茅根', '鲜藕', '鲜小蓟根']),
    )
    expect(merged.find((f) => f.name === '滋阴清燥汤')?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['滑石', '生山药']),
    )
    expect(merged.find((f) => f.name === '辟秽驱毒饮')?.herbs.length).toBeGreaterThanOrEqual(4)
    expect(merged.find((f) => f.name === '解毒活血汤')?.herbs.length).toBeGreaterThanOrEqual(8)
  })
})
