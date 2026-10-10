import { describe, expect, it } from 'vitest'
import { reasoningCardVisibility } from './reasoning-display'

describe('reasoningCardVisibility', () => {
  it('未校对时隐藏功效、药性与方性图，已校对时展示', () => {
    expect(reasoningCardVisibility('ai-draft')).toEqual({
      showFunction: false,
      showNatures: false,
      showNatureChart: false,
      hiddenNote: '功效与药性尚未校对，暂不展示',
    })
    expect(reasoningCardVisibility('reviewed')).toEqual({
      showFunction: true,
      showNatures: true,
      showNatureChart: true,
      hiddenNote: null,
    })
  })
})
