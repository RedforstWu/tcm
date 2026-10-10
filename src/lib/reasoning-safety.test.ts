import { describe, expect, it } from 'vitest'
import { reasoningSafetyNotice } from './reasoning-safety'

describe('reasoningSafetyNotice', () => {
  it('有结果时只提示就医，经期再加强，文案不含剂量、服法和药单', () => {
    const general = reasoningSafetyNotice([])
    expect(general).toEqual(['请就医，遵医嘱。此处按讲义症状检索方剂，不能代替诊疗。'])

    const menstrual = reasoningSafetyNotice(['感冒中间期 / 往来寒热 / 月经期感冒'])
    expect(menstrual).toEqual([
      '请就医，遵医嘱。此处按讲义症状检索方剂，不能代替诊疗。',
      '经期用药须由医师决定。',
    ])

    const text = menstrual.join('')
    expect(text).not.toMatch(/两|枚|服法|药单|克|钱/)
  })
})
