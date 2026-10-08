import { describe, expect, it } from 'vitest'
import {
  extractQingDoseRaw,
  parseChineseNumber,
  parseQingDose,
  QIAN_PER_LIANG,
} from './qing-dose.ts'

describe('parseChineseNumber', () => {
  it('parses arabic and chinese numerals', () => {
    expect(parseChineseNumber('三')).toBe(3)
    expect(parseChineseNumber('叁')).toBe(3)
    expect(parseChineseNumber('壹')).toBe(1)
    expect(parseChineseNumber('十二')).toBe(12)
    expect(parseChineseNumber('两半')).toBe(2.5)
  })
})

describe('extractQingDoseRaw', () => {
  it('extracts dose from paren forms', () => {
    expect(extractQingDoseRaw('白术（一两，土炒）')).toBe('一两')
    expect(extractQingDoseRaw('白芍（酒炒，五钱）')).toBe('五钱')
    expect(extractQingDoseRaw('人参（二钱）')).toBe('二钱')
  })

  it('extracts uppercase dose forms', () => {
    expect(extractQingDoseRaw('白朮（伍钱）')).toBe('伍钱')
    expect(extractQingDoseRaw('人参（壹钱）')).toBe('壹钱')
  })

  it('handles 等分', () => {
    expect(extractQingDoseRaw('桂枝各等分')).toBe('等分')
  })
})

describe('parseQingDose', () => {
  it('converts 两 to 钱', () => {
    const dose = parseQingDose('白术（一两，土炒）')
    expect(dose.doseLiang).toBe(1)
    expect(dose.doseQian).toBe(QIAN_PER_LIANG)
  })

  it('parses 钱 and 分', () => {
    expect(parseQingDose('甘草（一钱）').doseQian).toBe(1)
    expect(parseQingDose('陈皮（五分）').doseQian).toBe(0.5)
  })

  it('parses 一两半', () => {
    const dose = parseQingDose('黄芪一两半')
    expect(dose.doseLiang).toBe(1.5)
    expect(dose.doseQian).toBe(15)
  })
})
