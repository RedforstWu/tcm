import { describe, expect, it } from 'vitest'
import { resolveMentionedFormulaName } from './formula-mention.ts'

describe('resolveMentionedFormulaName', () => {
  const existing = new Set(['bianzheng:宜春汤', 'jingui:大承气汤'])

  it('strips lead words before formula name', () => {
    expect(resolveMentionedFormulaName('宜大承气汤', 'jingui', existing)).toBe('大承气汤')
    expect(resolveMentionedFormulaName('与小柴胡汤', 'songben', existing)).toBe('小柴胡汤')
    expect(resolveMentionedFormulaName('宜常服当归散', 'jingui', existing)).toBe('当归散')
    expect(resolveMentionedFormulaName('此六味地黄汤方', 'shishi', existing)).toBe('六味地黄汤')
  })

  it('keeps names that already exist with the lead character', () => {
    expect(resolveMentionedFormulaName('宜春汤方', 'bianzheng', existing)).toBe('宜春汤')
  })

  it('keeps short names intact', () => {
    expect(resolveMentionedFormulaName('与汤', 'songben', existing)).toBe('与汤')
  })
})
