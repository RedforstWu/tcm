import { describe, expect, it } from 'vitest'
import { joinBencaoHardBreaks, parseBencaoNatureFlavor } from './bencao.ts'

describe('joinBencaoHardBreaks', () => {
  it('joins hard line breaks', () => {
    const text = joinBencaoHardBreaks('白术，味甘辛，气\n温，可升可降。')
    expect(text.replace(/\n/g, '')).toContain('气温')
  })
})

describe('parseBencaoNatureFlavor', () => {
  it('parses 白术 meta', () => {
    const meta = parseBencaoNatureFlavor(
      '白术，味甘辛，气温，可升可降，阳中阴也，无毒。入心、脾、胃、肾、三焦之经。除湿消食。',
    )
    expect(meta.flavor).toContain('甘')
    expect(meta.nature).toBe('温')
    expect(meta.channels).toContain('脾')
    expect(meta.toxicity).toBe('无毒')
  })
})
