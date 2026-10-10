import { describe, expect, it } from 'vitest'
import { collationNoteForFormula } from './formula-collation'

describe('formula collation', () => {
  it('桂枝加葛根汤提示林亿意见，且不改传入的药物列表', () => {
    const herbs = ['葛根', '麻黄', '芍药', '生姜', '甘草', '大枣', '桂枝']
    const snapshot = [...herbs]
    const note = collationNoteForFormula('songben-formula-桂枝加葛根汤', herbs)
    expect(note).toContain('林亿')
    expect(note).toContain('麻黄')
    expect(herbs).toEqual(snapshot)
    expect(collationNoteForFormula('songben-formula-桂枝汤', herbs)).toBeNull()
  })
})
