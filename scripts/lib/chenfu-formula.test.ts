import { describe, expect, it } from 'vitest'
import {
  extractChenfuFormulaBlocks,
  parseChenfuHerbLine,
  splitChenfuHerbLine,
} from './chenfu-formula.ts'
import { buildHerbLexicon } from './herb-lexicon.ts'

const lexicon = buildHerbLexicon()

describe('splitChenfuHerbLine', () => {
  it('splits paren-glued herbs', () => {
    const tokens = splitChenfuHerbLine(
      '石膏（一两）知母（二钱）麦冬（二两）',
      lexicon,
    )
    expect(tokens.length).toBeGreaterThanOrEqual(3)
    expect(tokens[0]).toContain('石膏')
  })

  it('splits shared 各 dose', () => {
    const tokens = splitChenfuHerbLine('甘草人参柴胡栀子（各一钱）', lexicon)
    expect(tokens.length).toBe(4)
    expect(tokens.every((t) => t.includes('一钱'))).toBe(true)
  })
})

describe('parseChenfuHerbLine', () => {
  it('parses wan dai tang herbs', () => {
    const herbs = parseChenfuHerbLine('白术（一两，土炒）', lexicon)
    expect(herbs[0]?.name).toBe('白术')
    expect(herbs[0]?.doseQian).toBe(10)
  })
})

describe('extractChenfuFormulaBlocks', () => {
  it('parses wan dai tang block', () => {
    const body = `妇人有终年累月下流白物。治法宜大补脾胃之气。方用完带汤。
白术（一两，土炒）　　　山药（一两，炒）
人参（二钱）　　　　　　白芍（五钱，酒炒）
车前子（三钱，酒炒）　　苍术（三钱，製）
甘草（一钱）　　　　　　陈皮（五分）
黑芥穗（五分）　　　　　柴胡（六分）
水煎服。二剂轻，四剂止。
此方脾、胃、肝三经同治之法，寓补于散之中，寄消于升之内。`

    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0]!.name).toContain('完带')
    expect(blocks[0]!.herbs.length).toBeGreaterThanOrEqual(8)
    expect(blocks[0]!.fangjie.length).toBeGreaterThan(10)
  })

  it('parses bianzheng alternate formula', () => {
    const body = `冬月伤寒，发热头痛。
方用∶
石膏（一两）知母（二钱）麦冬（二两）竹叶（二百片）茯苓（三钱）甘草（一钱）人参（三钱）柴胡（一钱）栀子（一钱）水煎服。
此即白虎汤变方，用石膏、知母以泻其阳明之火邪。
或惧前方太重，则清肃汤亦可用也。
石膏（五钱）知母（一钱）麦冬（一两）甘草人参柴胡栀子（各一钱）独活半夏（各五分）水煎服。`

    const blocks = extractChenfuFormulaBlocks(body, {
      lexicon,
      anonymousPrefix: '伤寒门·第1则',
    })
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0]!.derivedFrom.some((d) => d.name.includes('白虎'))).toBe(true)
  })
})
