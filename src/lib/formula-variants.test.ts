import { describe, expect, it } from 'vitest'
import { isSingleHerbAddition } from './formula-variants'

describe('isSingleHerbAddition', () => {
  it('单味加味算加减，大段改方不算', () => {
    expect(isSingleHerbAddition({ kind: 'add' })).toBe(true)
    expect(
      isSingleHerbAddition({ kind: 'multi', addedHerbNames: ['半夏'], removedHerbNames: [] }),
    ).toBe(true)
    expect(
      isSingleHerbAddition({ kind: 'multi', addedHerbNames: ['杏仁'], removedHerbNames: ['葛根'] }),
    ).toBe(false)
  })
})
