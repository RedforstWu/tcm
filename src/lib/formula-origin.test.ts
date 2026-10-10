import { describe, expect, it } from 'vitest'
import { backfillOriginNote, formulaOriginNote, sameNameVariantNote } from './formula-origin'

describe('formulaOriginNote', () => {
  it('回填方标明来源，药物不同的同名方单独标注', () => {
    expect(backfillOriginNote('songben-formula-桂枝汤')).toBe(
      '本书未载此方组成。药物与煎服法来自宋本伤寒论「桂枝汤」，不是本书原文。',
    )
    expect(
      formulaOriginNote(
        { name: '桂枝汤', herbsBackfilledFrom: 'songben-formula-桂枝汤', herbs: [{ herbId: '桂枝' }] },
        null,
      ),
    ).toContain('不是本书原文')
    expect(
      formulaOriginNote(
        { name: '桂枝汤', herbs: [{ herbId: '桂心' }, { herbId: '干姜' }] },
        { herbs: [{ herbId: '桂枝' }, { herbId: '芍药' }] },
      ),
    ).toBe(sameNameVariantNote('桂枝汤'))
    expect(
      formulaOriginNote(
        { name: '桂枝汤', herbs: [{ herbId: '桂枝' }] },
        { herbs: [{ herbId: '桂枝' }] },
      ),
    ).toBeNull()
  })
})
