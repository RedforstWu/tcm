import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractParenDoseFormulaBlocks,
  isPlausibleFormulaName,
  mergeParenDoseFormulas,
  parseDerivedFormulaLine,
  splitParagraphs,
} from './generic-wiki-parse.ts'
import type { Formula } from '../../src/types/data.ts'

describe('wenbing paren-dose / derived formulas', () => {
  it('keeps short 【方】 paragraphs', () => {
    const parts = splitParagraphs(
      '此条与上文少异者，只已经发汗一句。\n\n【白虎加苍术汤方】\n即于白虎汤内加苍术（三钱）。\n\n汗多而脉散大。',
      24,
    )
    expect(parts.some((p) => p.includes('白虎加苍术汤'))).toBe(true)
  })

  it('parses 即于…去…加…', () => {
    const derived = parseDerivedFormulaLine('即于加减复脉汤内，去麻仁，加牡蛎一两。')
    expect(derived?.baseName).toBe('加减复脉汤')
    expect(derived?.removeNames).toContain('麻仁')
    expect(derived?.addHerbs.map((h) => h.name)).toContain('牡蛎')
  })

  it('parses 即于白虎汤内加苍术', () => {
    const derived = parseDerivedFormulaLine('即于白虎汤内加苍术（三钱）。')
    expect(derived?.baseName).toBe('白虎汤')
    expect(derived?.addHerbs.map((h) => h.name)).toEqual(['苍术'])
  })

  it('extracts single-herb 一甲煎 and skips 见上焦篇 dirty 玉女煎', () => {
    const raw = readFileSync(path.join(process.cwd(), 'data/raw/wenbing-tiaobian.wiki'), 'utf8')
    const blocks = extractParenDoseFormulaBlocks(raw)
    const yijia = blocks.find((b) => b.name === '一甲煎')
    expect(yijia?.herbs.map((h) => h.name)).toEqual(['生牡蛎'])
    const yunv = blocks.find((b) => b.name === '玉女煎')
    expect(yunv?.herbs.some((h) => h.name === '风温')).toBeFalsy()
    const juhalf = blocks.find((b) => b.name === '橘半桂苓枳姜汤')
    expect(juhalf?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['半夏', '陈皮', '桂枝', '生姜']),
    )
  })

  it('resolves 三甲复脉汤 from 加减复脉汤 chain', () => {
    const raw = readFileSync(path.join(process.cwd(), 'data/raw/wenbing-tiaobian.wiki'), 'utf8')
    const base: Formula[] = [
      {
        id: 'wenbing-formula-加减复脉汤',
        name: '加减复脉汤',
        book: 'wenbing',
        herbs: [
          { herbId: '炙甘草', name: '炙甘草', rawText: '炙甘草', doseRaw: '六钱' },
          { herbId: '干地黄', name: '干地黄', rawText: '干地黄', doseRaw: '六钱' },
          { herbId: '生白芍', name: '生白芍', rawText: '生白芍', doseRaw: '六钱' },
          { herbId: '麦冬', name: '麦冬', rawText: '麦冬', doseRaw: '五钱' },
          { herbId: '阿胶', name: '阿胶', rawText: '阿胶', doseRaw: '三钱' },
          { herbId: '火麻仁', name: '火麻仁', rawText: '火麻仁', doseRaw: '三钱' },
        ],
        preparation: '',
        modifications: [],
        sourceClauseIds: [],
      },
      {
        id: 'wenbing-formula-白虎汤',
        name: '白虎汤',
        book: 'wenbing',
        herbs: [
          { herbId: '生石膏', name: '生石膏', rawText: '生石膏', doseRaw: '一两' },
          { herbId: '知母', name: '知母', rawText: '知母', doseRaw: '五钱' },
          { herbId: '生甘草', name: '生甘草', rawText: '生甘草', doseRaw: '二钱' },
          { herbId: '白粳米', name: '白粳米', rawText: '白粳米', doseRaw: '一合' },
        ],
        preparation: '',
        modifications: [],
        sourceClauseIds: [],
      },
      {
        id: 'wenbing-formula-三甲复脉汤',
        name: '三甲复脉汤',
        book: 'wenbing',
        herbs: [],
        preparation: '',
        modifications: [],
        sourceClauseIds: [],
      },
      {
        id: 'wenbing-formula-白虎加苍术汤',
        name: '白虎加苍术汤',
        book: 'wenbing',
        herbs: [],
        preparation: '',
        modifications: [],
        sourceClauseIds: [],
      },
    ]
    const merged = mergeParenDoseFormulas(base, extractParenDoseFormulaBlocks(raw), 'wenbing')
    const sanjia = merged.find((f) => f.name === '三甲复脉汤')
    expect(sanjia?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['炙甘草', '生牡蛎', '生鳖甲', '生龟板']),
    )
    const baihu = merged.find((f) => f.name === '白虎加苍术汤')
    expect(baihu?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['生石膏', '知母', '苍术']),
    )
  })

  it('rejects discourse/junk formula shells', () => {
    expect(isPlausibleFormulaName('两许煮作茶汤')).toBe(false)
    expect(isPlausibleFormulaName('温宜散')).toBe(false)
    expect(isPlausibleFormulaName('桂枝以热散')).toBe(false)
    expect(isPlausibleFormulaName('石膏粳米汤')).toBe(true)
  })

  it('extracts wenre 六一散 variants and 金花汤', () => {
    const raw = readFileSync(path.join(process.cwd(), 'data/raw/wenre-jingwei.wiki'), 'utf8')
    const blocks = extractParenDoseFormulaBlocks(raw)
    const merged = mergeParenDoseFormulas([], blocks, 'wenre')
    expect(merged.find((f) => f.name === '碧玉散')?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['滑石', '甘草', '青黛']),
    )
    expect(merged.find((f) => f.name === '金花汤')?.herbs.map((h) => h.name)).toEqual(
      expect.arrayContaining(['黄连', '黄芩', '黄柏']),
    )
  })
})
