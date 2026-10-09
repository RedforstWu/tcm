import { describe, expect, it } from 'vitest'
import {
  canonicalizeChenfuHerb,
  segmentHerbNames,
  buildHerbLexicon,
  isKnownHerbName,
  normalizeHerbNameForCompare,
  resolveKnownHerbName,
} from './herb-lexicon.ts'

describe('canonicalizeChenfuHerb', () => {
  it('maps chenfu aliases', () => {
    expect(canonicalizeChenfuHerb('生军')).toBe('大黄')
    expect(canonicalizeChenfuHerb('黑丑')).toBe('牵牛子')
    expect(canonicalizeChenfuHerb('熟地')).toBe('熟地黄')
    expect(canonicalizeChenfuHerb('黑芥穗')).toBe('荆芥穗')
  })
})

describe('segmentHerbNames', () => {
  it('segments glued herb names', () => {
    const lexicon = buildHerbLexicon()
    expect(segmentHerbNames('甘草人参柴胡栀子', lexicon)).toEqual([
      '甘草',
      '人参',
      '柴胡',
      '栀子',
    ])
  })

  it('segments alias spellings and canonicalizes them', () => {
    const lexicon = buildHerbLexicon()
    expect(segmentHerbNames('破故纸远志', lexicon)).toEqual(['补骨脂', '远志'])
    expect(segmentHerbNames('黄耆白朮茯苓', lexicon)).toEqual(['黄芪', '白术', '茯苓'])
    expect(segmentHerbNames('北五味广木香', lexicon)).toEqual(['五味子', '木香'])
  })

  it('segments dose-glued lines after paren split', () => {
    const lexicon = buildHerbLexicon()
    // 调用方通常先按 ） 切开，此处验证单段
    expect(segmentHerbNames('石膏', lexicon)).toEqual(['石膏'])
    expect(segmentHerbNames('知母', lexicon)).toEqual(['知母'])
  })
})

describe('resolveKnownHerbName', () => {
  it('经别名规范后解析到已知药名', () => {
    expect(resolveKnownHerbName('黄耆')).toBe('黄芪')
    expect(resolveKnownHerbName('蜀椒')).toBe('花椒')
    expect(resolveKnownHerbName('芍藥（炒）')).toBe('芍药')
  })

  it('收录金匮古籍药名', () => {
    for (const name of ['川乌', '鼠妇', '蜣螂', '紫葳', '獭肝', '矾石', '钟乳', '太乙余粮', '生狼牙']) {
      expect(resolveKnownHerbName(name)).toBe(name)
    }
  })

  it('收录宋本附方 / 烧裈散药名（只用于校验，不进切词词表）', () => {
    for (const name of ['食蜜', '大猪胆', '妇人中裈']) {
      expect(resolveKnownHerbName(name)).toBe(name)
      expect(buildHerbLexicon()).not.toContain(name)
    }
    // 「近隐处」是炮制描述，整串仍不可解析
    expect(resolveKnownHerbName('妇人中裈近隐处')).toBeNull()
  })

  it('斑蝥去掉重复键后仍可解析', () => {
    expect(resolveKnownHerbName('斑蝥')).toBe('斑蝥')
    expect(canonicalizeChenfuHerb('斑蝥')).toBe('斑蝥')
  })

  it('注语 / 加减语 / 炮制语不可解析', () => {
    for (const token of ['不可屈伸', '熬焦', '减白术共六味', '春三月加枳实', '']) {
      expect(resolveKnownHerbName(token)).toBeNull()
      expect(isKnownHerbName(token)).toBe(false)
    }
  })

  it('不改变 segmentHerbNames 使用的词表', () => {
    // 古籍补录名只用于校验，不进入陈复切词词表
    expect(buildHerbLexicon()).not.toContain('獭肝')
  })
})

describe('normalizeHerbNameForCompare', () => {
  it('两侧按同一规范名比较；不可解析时回退到去注语后的原名', () => {
    expect(normalizeHerbNameForCompare('黄柏')).toBe(normalizeHerbNameForCompare('黄檗'))
    expect(normalizeHerbNameForCompare('芎藭')).toBe('川芎')
    expect(normalizeHerbNameForCompare('某某草（炙）')).toBe('某某草')
  })
})

describe('古籍药名异写归并（伤寒论交叉比对「疑同药」）', () => {
  // [本地写法, KB 写法, 规范名]
  const pairs: Array<[string, string, string]> = [
    ['蜂窝', '蜂巢', '蜂房'],
    ['石苇', '石韦', '石韦'],
    ['太一禹余粮', '禹余粮', '禹余粮'],
    ['代赭', '代赭石', '代赭石'],
    ['茵陈蒿', '茵陈', '茵陈'],
    ['肥栀子', '栀子', '栀子'],
    ['蒴藿细叶', '蒴藋细叶', '蒴藋细叶'],
    ['蒴藿', '蒴藋', '蒴藋'],
    ['萎蕤', '葳蕤', '玉竹'],
    ['括萎根', '栝楼根', '天花粉'],
  ]

  it.each(pairs)('%s 与 %s 归并为 %s', (local, kb, canonical) => {
    expect(resolveKnownHerbName(local)).toBe(canonical)
    expect(resolveKnownHerbName(kb)).toBe(canonical)
    expect(resolveKnownHerbName(canonical)).toBe(canonical)
    expect(normalizeHerbNameForCompare(local)).toBe(normalizeHerbNameForCompare(kb))
  })

  it('带炮制注 / 繁体写法同样归并', () => {
    expect(resolveKnownHerbName('蒴藿細葉（燒）')).toBe('蒴藋细叶')
    expect(resolveKnownHerbName('肥梔子（擘）')).toBe('栀子')
    expect(resolveKnownHerbName('太一禹餘糧（碎）')).toBe('禹余粮')
  })

  it('瓜子与冬瓜子不归并（大黄牡丹汤之瓜子有冬瓜子、甜瓜子两说）', () => {
    expect(resolveKnownHerbName('瓜子')).toBe('瓜子')
    expect(resolveKnownHerbName('冬瓜子')).toBe('冬瓜子')
    expect(normalizeHerbNameForCompare('瓜子')).not.toBe(normalizeHerbNameForCompare('冬瓜子'))
  })

  it('异写只用于校验，不进切词词表', () => {
    const lexicon = buildHerbLexicon()
    for (const variant of ['蜂巢', '太一禹余粮', '代赭', '肥栀子', '蒴藿细叶', '萎蕤', '括萎根', '浓朴']) {
      expect(lexicon).not.toContain(variant)
    }
  })

  it('浓朴 / 濃朴（底本转换错误）与厚朴归并', () => {
    expect(resolveKnownHerbName('浓朴')).toBe('厚朴')
    expect(resolveKnownHerbName('濃朴（炙）')).toBe('厚朴')
    expect(normalizeHerbNameForCompare('浓朴')).toBe(normalizeHerbNameForCompare('厚朴'))
    expect(canonicalizeChenfuHerb('濃朴')).toBe('厚朴')
  })

  it('药物库规范名与校验共用同一份异写表', () => {
    for (const [local, , canonical] of pairs) {
      expect(canonicalizeChenfuHerb(local)).toBe(canonical)
    }
  })
})
