import { describe, expect, it } from 'vitest'
import { doseAwareScore, type MatchHerb } from './formula-match'

const guizhi: MatchHerb[] = [
  { herbId: '桂枝', name: '桂枝', doseLiang: 3, doseRaw: '三两' },
  { herbId: '芍药', name: '芍药', doseLiang: 3, doseRaw: '三两' },
  { herbId: '甘草', name: '甘草', doseLiang: 2, doseRaw: '二两' },
  { herbId: '生姜', name: '生姜', doseLiang: 3, doseRaw: '三两' },
  { herbId: '大枣', name: '大枣', doseCount: 12, doseRaw: '十二枚' },
]

describe('doseAwareScore', () => {
  it('药味相同但剂量不同时低于 100%，并写明差异', () => {
    const jiaGui = guizhi.map((herb) =>
      herb.herbId === '桂枝' ? { ...herb, doseLiang: 5, doseRaw: '五两' } : herb,
    )
    const jiaShao = guizhi.map((herb) =>
      herb.herbId === '芍药' ? { ...herb, doseLiang: 6, doseRaw: '六两' } : herb,
    )

    const gui = doseAwareScore(guizhi, jiaGui)
    expect(gui.score).toBeCloseTo(0.92, 10)
    expect(gui.doseNotes).toEqual(['桂枝：三两 / 五两'])

    const shao = doseAwareScore(guizhi, jiaShao)
    expect(shao.score).toBeCloseTo(0.9, 10)
    expect(shao.doseNotes).toEqual(['芍药：三两 / 六两'])

    const same = doseAwareScore(guizhi, guizhi)
    expect(same.score).toBe(1)
    expect(same.doseNotes).toEqual([])
  })
})
