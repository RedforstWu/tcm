import { describe, expect, it } from 'vitest'
import { CLASSICAL_HERB_VARIANTS, canonicalizeHerbName, listKnownHerbs, parseHerbToken } from './herbs.ts'
import { parseChineseNumber, parseDose } from './dose.ts'

describe('herbs', () => {
  it('canonicalizes aliases and typos', () => {
    expect(canonicalizeHerbName('栝蒌根')).toBe('天花粉')
    expect(canonicalizeHerbName('黄岑')).toBe('黄芩')
    expect(canonicalizeHerbName('白朮')).toBe('白术')
    expect(canonicalizeHerbName('芎䓖')).toBe('川芎')
    expect(canonicalizeHerbName('芎')).toBe('川芎')
  })

  describe('古籍药名异写（CLASSICAL_HERB_VARIANTS）', () => {
    it.each(Object.entries(CLASSICAL_HERB_VARIANTS))('%s 归并为 %s，且目标为不动点', (variant, standard) => {
      expect(canonicalizeHerbName(variant)).toBe(standard)
      expect(canonicalizeHerbName(standard)).toBe(standard)
    })

    it('浓朴 / 濃朴 经 parseHerbToken 归并为厚朴，herbId 随之统一', () => {
      for (const token of ['浓朴四两（炙）', '濃朴二两', '厚朴半斤（炙，去皮）']) {
        const parsed = parseHerbToken(token)
        expect(parsed?.name).toBe('厚朴')
        expect(parsed?.herbId).toBe('厚朴')
      }
    })

    it('其余异写经 parseHerbToken 归并（带剂量 / 炮制注）', () => {
      expect(parseHerbToken('代赭一两（碎）')?.name).toBe('代赭石')
      expect(parseHerbToken('茵陈蒿六两')?.name).toBe('茵陈')
      expect(parseHerbToken('肥栀子十四枚（擘）')?.name).toBe('栀子')
      expect(parseHerbToken('括萎根四两')?.name).toBe('天花粉')
      expect(parseHerbToken('太一禹余粮一斤（碎）')?.name).toBe('禹余粮')
    })

    it('只做整名匹配：粘连的两味、带修饰的写法不被子串规则吞并', () => {
      for (const glued of ['藜芦代赭', '葳蕤甘草', '杜仲浓朴', '浓朴乌头', '石苇白蔹', '紫浓朴', '蜀萎蕤', '代赭石末']) {
        expect(canonicalizeHerbName(glued)).toBe(glued)
      }
    })

    it('不误伤已有规范名、含异写的方名与含「浓」的词', () => {
      for (const name of ['代赭石', '茵陈', '茵陈五苓散', '茵陈蒿汤', '厚朴', '紫厚朴', '蒴藋细叶', '栀子仁', '浓']) {
        expect(canonicalizeHerbName(name)).toBe(name)
      }
    })

    it('瓜子与冬瓜子不归并', () => {
      expect(canonicalizeHerbName('瓜子')).toBe('瓜子')
      expect(canonicalizeHerbName('冬瓜子')).toBe('冬瓜子')
    })

    it('异写及其归并目标不进 listKnownHerbs（不改变陈傅切词词表）', () => {
      const known = new Set(listKnownHerbs())
      for (const variant of Object.keys(CLASSICAL_HERB_VARIANTS)) {
        expect(known.has(variant)).toBe(false)
      }
      for (const standard of ['石韦', '蒴藋', '蒴藋细叶']) {
        expect(known.has(standard)).toBe(false)
      }
    })
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
