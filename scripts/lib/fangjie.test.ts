import { describe, expect, it } from 'vitest'
import { extractHerbRolesFromFangjie } from './fangjie.ts'

describe('extractHerbRolesFromFangjie', () => {
  it('extracts 益之以X之Y pairs', () => {
    const roles = extractHerbRolesFromFangjie({
      formulaId: 'test-1',
      fangjie: '而又益之以茵陈之利湿，栀子之清热，肝气得清。',
      herbIds: ['茵陈', '栀子', '柴胡'],
      herbNames: ['茵陈', '栀子', '柴胡'],
    })
    expect(roles.some((r) => r.herbId === '茵陈' && r.roleText.includes('利湿'))).toBe(true)
    expect(roles.some((r) => r.herbId === '栀子' && r.roleText.includes('清热'))).toBe(true)
  })

  it('extracts 用X以Y', () => {
    const roles = extractHerbRolesFromFangjie({
      formulaId: 'test-2',
      fangjie: '用石膏、知母以泻其阳明之火邪。',
      herbIds: ['石膏', '知母', '麦冬'],
      herbNames: ['石膏', '知母', '麦冬'],
    })
    expect(roles.filter((r) => r.herbId === '石膏' || r.herbId === '知母').length).toBeGreaterThanOrEqual(2)
  })

  it('ignores herbs not in formula', () => {
    const roles = extractHerbRolesFromFangjie({
      formulaId: 'test-3',
      fangjie: '用黄连以清热。',
      herbIds: ['白术'],
      herbNames: ['白术'],
    })
    expect(roles.length).toBe(0)
  })
})
