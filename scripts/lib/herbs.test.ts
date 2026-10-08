import { describe, expect, it } from 'vitest'
import { canonicalizeHerbName, parseHerbToken } from './herbs.ts'
import { parseChineseNumber, parseDose } from './dose.ts'

describe('herbs', () => {
  it('canonicalizes aliases and typos', () => {
    expect(canonicalizeHerbName('栝蒌根')).toBe('天花粉')
    expect(canonicalizeHerbName('黄岑')).toBe('黄芩')
    expect(canonicalizeHerbName('白朮')).toBe('白术')
    expect(canonicalizeHerbName('芎䓖')).toBe('川芎')
    expect(canonicalizeHerbName('芎')).toBe('川芎')
  })

  it('parses herb token with processing', () => {
    const parsed = parseHerbToken('桂枝三两（去皮）')
    expect(parsed?.name).toBe('桂枝')
    expect(parsed?.processing).toContain('去皮')
  })
})

describe('dose', () => {
  it('parses chinese numbers', () => {
    expect(parseChineseNumber('三')).toBe(3)
    expect(parseChineseNumber('十二')).toBe(12)
    expect(parseChineseNumber('半')).toBe(0.5)
  })

  it('parses liang and dual gram conversions', () => {
    const dose = parseDose('桂枝三两（去皮）')
    expect(dose.doseLiang).toBe(3)
    expect(dose.gramsArchaeology).toBe(46.88)
    expect(dose.gramsTextbook).toBe(9)
  })

  it('does not treat 半夏 name as dose 半', () => {
    expect(parseDose('半夏（洗）').doseRaw).toBe('')
    expect(parseDose('半夏等分').doseRaw).toBe('等分')
    expect(parseDose('乌梅三百枚').doseRaw).toBe('三百枚')
  })
})
