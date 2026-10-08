import { describe, expect, it } from 'vitest'
import { computeFloatingPosition } from './floating-position'

const PHONE = { viewportWidth: 375, viewportHeight: 700 }

describe('computeFloatingPosition', () => {
  it('锚点在左上区域时放在右下方', () => {
    const position = computeFloatingPosition({
      ...PHONE,
      anchorX: 40,
      anchorY: 100,
      floatingWidth: 300,
    })
    expect(position).toEqual({ left: 52, top: 112 })
  })

  it('锚点靠右时向左收回，不超出视口右缘', () => {
    const position = computeFloatingPosition({
      ...PHONE,
      anchorX: 360,
      anchorY: 100,
      floatingWidth: 300,
    })
    expect(position.left).toBe(375 - 300 - 8)
    expect(position.left + 300).toBeLessThanOrEqual(375 - 8)
  })

  it('浮层比视口还宽时贴左侧留白', () => {
    const position = computeFloatingPosition({
      viewportWidth: 280,
      viewportHeight: 600,
      anchorX: 200,
      anchorY: 50,
      floatingWidth: 320,
    })
    expect(position.left).toBe(8)
  })

  it('锚点靠近底部时改为向上展开', () => {
    const position = computeFloatingPosition({
      ...PHONE,
      anchorX: 40,
      anchorY: 650,
      floatingWidth: 300,
    })
    expect(position.top).toBeUndefined()
    expect(position.bottom).toBe(700 - 650 + 12)
  })

  it('负坐标也会被夹在留白之内', () => {
    const position = computeFloatingPosition({
      ...PHONE,
      anchorX: -50,
      anchorY: -50,
      floatingWidth: 300,
    })
    expect(position).toEqual({ left: 8, top: 8 })
  })
})
