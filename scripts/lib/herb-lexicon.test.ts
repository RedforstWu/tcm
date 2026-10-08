import { describe, expect, it } from 'vitest'
import {
  canonicalizeChenfuHerb,
  segmentHerbNames,
  buildHerbLexicon,
} from './herb-lexicon.ts'

describe('canonicalizeChenfuHerb', () => {
  it('maps chenfu aliases', () => {
    expect(canonicalizeChenfuHerb('生军')).toBe('大黄')
    expect(canonicalizeChenfuHerb('黑丑')).toBe('牵牛子')
    expect(canonicalizeChenfuHerb('熟地')).toBe('熟地黄')
    expect(canonicalizeChenfuHerb('黑芥穗')).toBe('荆芥穗')
  })
})

describe('segmentHerbNames', () => {
  it('segments glued herb names', () => {
    const lexicon = buildHerbLexicon()
    expect(segmentHerbNames('甘草人参柴胡栀子', lexicon)).toEqual([
      '甘草',
      '人参',
      '柴胡',
      '栀子',
    ])
  })

  it('segments dose-glued lines after paren split', () => {
    const lexicon = buildHerbLexicon()
    // 调用方通常先按 ） 切开，此处验证单段
    expect(segmentHerbNames('石膏', lexicon)).toEqual(['石膏'])
    expect(segmentHerbNames('知母', lexicon)).toEqual(['知母'])
  })
})
