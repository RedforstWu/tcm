import { describe, expect, it } from 'vitest'
import {
  WILDCARD_CHAR,
  commentaryId,
  compareDoses,
  compareEntityIds,
  compareHerbSets,
  createFormulaNameResolver,
  doseQuantity,
  extractDoseText,
  findFormulaMentions,
  formulaHeadingName,
  isNearFormulaName,
  isNearHerbName,
  isQuoteVerified,
  judgeFormulaLink,
  locateWithWildcards,
  maskJobkokoMissingChars,
  maskKanripoMissingChars,
  mentionStrength,
  songbenClauseId,
  splitQuoteSegments,
  textVerdict,
  wildcardEditDistance,
  wildcardSimilarity,
} from './crosscheck-shanghan.ts'
import { prepareHaystack } from './text-normalize.ts'

describe('缺字遮蔽', () => {
  it('Kanripo 缺字实体等长替换为通配', () => {
    const source = '太陽&KR0238;風，脈浮。'
    const masked = maskKanripoMissingChars(source)
    expect(masked.text).toHaveLength(source.length)
    expect(masked.text.startsWith(`太陽${WILDCARD_CHAR}`)).toBe(true)
    expect(masked.stats.gaijiEntity).toBe(1)
  })

  it('jobkoko KT 占位与孤立空格替换为通配，药味间空格保留', () => {
    const masked = maskJobkokoMissingChars('項背強KT KT ，心下 ，桂枝 芍藥')
    expect(masked.text).toHaveLength('項背強KT KT ，心下 ，桂枝 芍藥'.length)
    expect(masked.stats.ktPlaceholder).toBe(2)
    expect(masked.stats.isolatedSpace).toBe(1)
    expect(masked.text.endsWith('桂枝 芍藥')).toBe(true)
  })

  it('原文已含通配字符时拒绝处理', () => {
    expect(() => maskKanripoMissingChars(`太陽${WILDCARD_CHAR}`)).toThrow()
    expect(() => maskJobkokoMissingChars(`太陽${WILDCARD_CHAR}`)).toThrow()
  })
})

describe('通配比较', () => {
  it('通配与任一字相配、或被跳过，均不计代价', () => {
    expect(wildcardEditDistance(`太阳${WILDCARD_CHAR}病`, '太阳中病')).toBe(0)
    expect(wildcardEditDistance(`太阳${WILDCARD_CHAR}病`, '太阳病')).toBe(0)
    expect(wildcardEditDistance('太阳病', '太阳中病')).toBe(1)
    expect(wildcardSimilarity('', '')).toBe(1)
    expect(wildcardSimilarity('太阳病', '少阴病')).toBeCloseTo(1 / 3)
  })

  it('短引文经通配精确定位，并映射回原文下标', () => {
    const source = '一曰：太陽&KR0238;風，脈陽浮而陰弱。'
    const prepared = prepareHaystack(maskKanripoMissingChars(source).text)
    const hit = locateWithWildcards('太陽中風', prepared)
    expect(hit).not.toBeNull()
    expect(hit!.exact).toBe(true)
    expect(hit!.usedWildcard).toBe(true)
    expect(hit!.ratio).toBe(1)
    expect(source.slice(hit!.start, hit!.end)).toBe('太陽&KR0238;風')
  })

  it('短引文不做模糊定位', () => {
    const prepared = prepareHaystack(maskKanripoMissingChars('一曰：太陽&KR0238;風，脈陽浮而陰弱。').text)
    expect(locateWithWildcards('少陰病', prepared)).toBeNull()
    expect(locateWithWildcards('太陽中寒', prepared)).toBeNull()
  })

  it('长引文模糊定位给出比率', () => {
    const prepared = prepareHaystack('前文若干。太陽病，頭痛發熱，汗出惡風，桂枝湯主之。後文若干。')
    const hit = locateWithWildcards('太陽病，頭痛發熱，汗出惡寒，桂枝湯主之。', prepared)
    expect(hit).not.toBeNull()
    expect(hit!.exact).toBe(false)
    expect(hit!.ratio).toBeGreaterThan(0.9)
    expect(hit!.ratio).toBeLessThan(1)
  })
})

describe('裁决阈值', () => {
  it('0.95 / 0.80 边界', () => {
    expect(textVerdict(1)).toBe('agree')
    expect(textVerdict(0.95)).toBe('agree')
    expect(textVerdict(0.9499)).toBe('variant')
    expect(textVerdict(0.8)).toBe('variant')
    expect(textVerdict(0.7999)).toBe('mismatch')
  })

  it('引文核验与 agree 同阈值', () => {
    expect(isQuoteVerified(0.95)).toBe(true)
    expect(isQuoteVerified(0.9499)).toBe(false)
    expect(isQuoteVerified(null)).toBe(false)
  })
})

describe('方名异名归一', () => {
  const kbFormulas = [
    { name: '桂枝去桂加茯苓白术汤', aliases: ['去桂枝加白术汤'] },
    { name: '白散', aliases: ['三物白散'] },
    { name: '桂枝汤', aliases: [] },
  ]

  it('导入 KB 异名与人工异名表，繁简归一', () => {
    const resolver = createFormulaNameResolver(kbFormulas)
    expect(resolver.same('白散', '三物白散')).toBe(true)
    expect(resolver.same('三物白散', '三物小白散')).toBe(true)
    expect(resolver.same('桂枝甘草汤', '桂技甘草汤')).toBe(true)
    expect(resolver.same('桂枝湯', '桂枝汤')).toBe(true)
    expect(resolver.same('桂枝汤', '桂枝甘草汤')).toBe(false)
  })

  it('跳过经核否决的 KB 异名', () => {
    const resolver = createFormulaNameResolver(kbFormulas)
    expect(resolver.same('桂枝去桂加茯苓白术汤', '去桂枝加白术汤')).toBe(false)
    expect(resolver.rejectedAliases.map((item) => item.alias)).toEqual(['去桂枝加白术汤'])
  })

  it('canonical 与登记顺序无关', () => {
    const forward = createFormulaNameResolver([], [], [{ names: ['甲汤', '乙汤'], kind: '原文异写', evidence: '测试' }])
    const backward = createFormulaNameResolver([], [], [{ names: ['乙汤', '甲汤'], kind: '原文异写', evidence: '测试' }])
    expect(forward.canonical('甲汤')).toBe(backward.canonical('甲汤'))
  })

  it('异名组少于两个方名时报错', () => {
    expect(() => createFormulaNameResolver([], [], [{ names: ['甲汤'], kind: '原文异写', evidence: '测试' }])).toThrow()
  })

  it('疑似错字方名（编辑距离 ≤ 1）', () => {
    expect(isNearFormulaName('桂枝甘草汤', '桂技甘草汤')).toBe(true)
    expect(isNearFormulaName('桂枝汤', '麻黄杏仁甘草石膏汤')).toBe(false)
  })

  it('方题行识别', () => {
    expect(formulaHeadingName('桂枝湯方')).toBe('桂枝湯')
    expect(formulaHeadingName('猪胆汁方（附方）')).toBe('猪胆汁')
    expect(formulaHeadingName('上五味，以水七升')).toBeNull()
  })
})

describe('方名出现判定', () => {
  const resolver = createFormulaNameResolver([], ['四逆汤', '通脉四逆汤', '桂枝汤', '麻黄汤'])

  it('长名优先，不把「通脉四逆汤」算作「四逆汤」', () => {
    const mentions = findFormulaMentions('少陰病，下利清穀，通脈四逆湯主之。', resolver)
    expect(mentions).toHaveLength(1)
    expect(mentions[0]!.canonical).toBe(resolver.canonical('通脉四逆汤'))
    expect(mentions[0]!.prescriptive).toBe(true)
  })

  it('禁用语境与叙述语境', () => {
    const [negated] = findFormulaMentions('若酒客病，不可与桂枝汤，得之则呕。', resolver)
    expect(negated!.negated).toBe(true)
    expect(negated!.prescriptive).toBe(false)
    const [narrative] = findFormulaMentions('服桂枝汤，大汗出后，大烦渴不解。', resolver)
    expect(narrative!.negated).toBe(false)
    expect(narrative!.prescriptive).toBe(false)
    const [prescribed] = findFormulaMentions('喘而胸满者，不可下，宜麻黄汤。', resolver)
    expect(prescribed!.prescriptive).toBe(true)
  })

  it('出现强度：处方 > 方题 > 叙述 > 方后注 > 否定 > 未见', () => {
    const canonical = resolver.canonical('桂枝汤')
    const base = { text: '', sectionHeadings: [] as string[], sectionBody: '' }
    expect(mentionStrength(canonical, { ...base, text: '桂枝汤主之' }, resolver)).toBe('prescribed')
    expect(mentionStrength(canonical, { ...base, sectionHeadings: ['桂枝湯'] }, resolver)).toBe('heading')
    expect(mentionStrength(canonical, { ...base, text: '服桂枝汤后' }, resolver)).toBe('mentioned')
    expect(mentionStrength(canonical, { ...base, sectionBody: '余如桂枝汤法' }, resolver)).toBe('sectionBody')
    expect(mentionStrength(canonical, { ...base, text: '不可与桂枝汤' }, resolver)).toBe('negated')
    expect(mentionStrength(canonical, base, resolver)).toBe('none')
  })
})

describe('条文→方剂关联裁决', () => {
  it('双方都有', () => {
    expect(judgeFormulaLink(true, true, 'prescribed')).toMatchObject({ verdict: 'agree', conclusion: '双方一致' })
    expect(judgeFormulaLink(true, true, 'mentioned')).toMatchObject({ verdict: 'agree', conclusion: '双方一致' })
    expect(judgeFormulaLink(true, true, 'negated')).toMatchObject({ verdict: 'agree', conclusion: '双方一致但需人工' })
  })

  it('仅 KB 有', () => {
    expect(judgeFormulaLink(true, false, 'heading').conclusion).toBe('本地漏')
    expect(judgeFormulaLink(true, false, 'none').conclusion).toBe('KB 多')
    expect(judgeFormulaLink(true, false, 'mentioned').conclusion).toBe('需人工')
    expect(judgeFormulaLink(true, false, 'none').verdict).toBe('mismatch')
  })

  it('仅本地有', () => {
    expect(judgeFormulaLink(false, true, 'prescribed').conclusion).toBe('KB 漏')
    expect(judgeFormulaLink(false, true, 'negated').conclusion).toBe('需人工')
  })

  it('双方都没有时报错', () => {
    expect(() => judgeFormulaLink(false, false, 'none')).toThrow()
  })
})

describe('药味集合比较', () => {
  const guizhi = ['桂枝', '芍药', '甘草', '生姜', '大枣']

  it('集合相同为 agree', () => {
    const result = compareHerbSets({ local: guizhi, kb: [...guizhi].reverse(), formulaComponents: [], componentHerbs: [] })
    expect(result.verdict).toBe('agree')
    expect(result.ratio).toBe(1)
  })

  it('疑同药记 variant', () => {
    expect(isNearHerbName('茵陈蒿', '茵陈')).toBe(true)
    expect(isNearHerbName('石苇', '石韦')).toBe(true)
    expect(isNearHerbName('参', '人参')).toBe(false)
    const result = compareHerbSets({ local: ['茵陈蒿', '栀子', '大黄'], kb: ['茵陈', '栀子', '大黄'], formulaComponents: [], componentHerbs: [] })
    expect(result.verdict).toBe('variant')
    expect(result.nearPairs).toEqual([{ local: '茵陈蒿', kb: '茵陈' }])
  })

  it('KB 多出的仅为食材/辅料记 variant', () => {
    const result = compareHerbSets({
      local: ['猪肤'],
      kb: ['猪肤', '白蜜'],
      formulaComponents: [],
      componentHerbs: [],
      kbAuxiliary: ['白蜜'],
    })
    expect(result.verdict).toBe('variant')
    expect(result.kbOnly).toEqual(['白蜜'])
  })

  it('以方为药成分展开可解释本地多出的药味', () => {
    const result = compareHerbSets({
      local: [...guizhi, '附子'],
      kb: ['附子'],
      formulaComponents: ['桂枝汤二升'],
      componentHerbs: guizhi,
    })
    expect(result.verdict).toBe('variant')
    expect(result.note).toContain('以方为药')
  })

  it('无法解释的差异记 mismatch', () => {
    const result = compareHerbSets({ local: guizhi, kb: [...guizhi, '大黄'], formulaComponents: [], componentHerbs: [] })
    expect(result.verdict).toBe('mismatch')
    expect(result.kbOnly).toEqual(['大黄'])
    expect(result.ratio).toBeCloseTo(5 / 6)
  })
})

describe('剂量', () => {
  const aliases: Record<string, string> = { 芎穷: '川芎', 蜀椒: '花椒', 代赭: '代赭石', 代赭石: '代赭石' }
  const resolve = (name: string) => aliases[name] ?? null

  it('从「药名+剂量+修治」中取出剂量', () => {
    expect(extractDoseText('芎穷一两', '川芎', resolve)).toBe('一两')
    expect(extractDoseText('蜀椒一两（炒去汗）', '花椒', resolve)).toBe('一两炒去汗')
    expect(extractDoseText('代赭石一两', '代赭石', resolve)).toBe('一两')
    expect(extractDoseText('蜀椒', '花椒', resolve)).toBe('')
    expect(extractDoseText('某药三两', '花椒', resolve)).toBe('某药三两')
  })

  it('数量部分：等价单位与「两半」', () => {
    expect(doseQuantity('十四个擘')).toBe(doseQuantity('十四枚'))
    expect(doseQuantity('两半')).toBe('一两半')
    expect(doseQuantity('各三两')).toBe('三两')
    expect(doseQuantity('大者五枚')).toBe('五枚')
  })

  it('逐味比较：一致 / 仅修治不同 / 数量不同', () => {
    expect(compareDoses([{ herb: '桂枝', local: '三两', kb: '三两' }])).toMatchObject({ verdict: 'agree', ratio: 1 })
    const variant = compareDoses([
      { herb: '桂枝', local: '三两', kb: '三两' },
      { herb: '甘草', local: '二两炙', kb: '二两' },
    ])
    expect(variant).toMatchObject({ verdict: 'variant', ratio: 0.5, compared: 2 })
    const mismatch = compareDoses([
      { herb: '桂枝', local: '三两', kb: '五两' },
      { herb: '甘草', local: '二两炙', kb: '二两' },
    ])
    expect(mismatch!.verdict).toBe('mismatch')
    expect(mismatch!.differences.map((item) => item.level)).toEqual(['mismatch', 'variant'])
  })

  it('无可比剂量时返回 null', () => {
    expect(compareDoses([{ herb: '桂枝', local: null, kb: '三两' }])).toBeNull()
    expect(compareDoses([])).toBeNull()
  })
})

describe('注家卡 id 与条文 id', () => {
  it('commentary-<注家>-<三位条文号>', () => {
    expect(commentaryId('尤怡', 12)).toBe('commentary-尤怡-012')
    expect(commentaryId(' 成无己 ', 398)).toBe('commentary-成无己-398')
  })

  it('条文号越界或注家名非法时报错', () => {
    expect(() => commentaryId('尤怡', 0)).toThrow(RangeError)
    expect(() => commentaryId('尤怡', 399)).toThrow(RangeError)
    expect(() => commentaryId('尤怡', 1.5)).toThrow(RangeError)
    expect(() => commentaryId('', 1)).toThrow()
    expect(() => commentaryId('尤 怡', 1)).toThrow()
    expect(songbenClauseId(1)).toBe('songben-1')
    expect(songbenClauseId(398)).toBe('songben-398')
  })

  it('引文按省略号拆段，KT 占位换成通配', () => {
    expect(splitQuoteSegments('當用桂枝以補心陽……必加附子以回腎陽。')).toEqual(['當用桂枝以補心陽', '必加附子以回腎陽。'])
    expect(splitQuoteSegments('……')).toEqual([])
    const [masked] = splitQuoteSegments('KTKT，項背牽動之象')
    expect(masked).toContain(WILDCARD_CHAR)
    expect(masked).not.toContain('KT')
  })

  it('实体 id 按尾部数字排序', () => {
    expect(['songben-10', 'songben-2', 'songben-1'].sort(compareEntityIds)).toEqual(['songben-1', 'songben-2', 'songben-10'])
  })
})
