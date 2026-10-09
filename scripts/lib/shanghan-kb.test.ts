import { describe, expect, it } from 'vitest'
import { parseMarkdownWithFrontmatter } from './markdown-frontmatter.ts'
import {
  SONGBEN_CLAUSE_LAST,
  alignFormulaHerbs,
  buildKbDataset,
  checkClauseSequence,
  convertClauseCard,
  convertCommentaryCard,
  convertFormulaCard,
  convertHerbCard,
  convertSyndromeCard,
  mapSourceBooks,
  normalizeTermList,
  parseFormulaSourceRefs,
  splitEvidenceLocators,
  type KbCard,
} from './shanghan-kb.ts'

function cardOf(locator: string, markdown: string): KbCard {
  const parsed = parseMarkdownWithFrontmatter(markdown)
  if (!parsed.ok) throw new Error(`测试样例 frontmatter 无效：${parsed.message}`)
  return { locator, data: parsed.data, body: parsed.body }
}

const CLAUSE_012 = [
  '---',
  'type: 条文',
  '条文号: 12',
  '六经: 太阳病',
  '篇: 辨太阳病脉证并治上',
  '版本来源: 宋本',
  '康平层次: 原文',
  '版本争议: false',
  '关联方剂: ["[[桂枝汤]]"]',
  '症状标签: ["发热", "恶寒"]',
  '核验状态: 待核',
  '---',
  '',
  '# 条文 012',
  '',
  '## 原文（宋版）',
  '> 太阳中风，阳浮而阴弱，……鼻鸣干呕者，桂枝汤主之。',
  '',
  '## 治法方药',
  '- 原文载方：[[桂枝汤]]。',
].join('\r\n')

const FORMULA_GUIZHI = [
  '---',
  'type: 方剂',
  '方名: 桂枝汤',
  '异名: []',
  '出处: 伤寒论',
  '原文编号: ["12", 13, "方1"]',
  '剂型: 汤剂',
  '组成: ["桂枝", "芍药", "[[瓜蒂]]"]',
  '药物链接: ["[[桂枝]]", "[[陈皮|芍药]]", "蜂蜜（食材/辅料，不建药物卡）"]',
  '汉代剂量: ["桂枝三两去皮", "三两", "大瓜蒂一分"]',
  '折算剂量: ["45g", "45g", "待核"]',
  '煎服法: 以水七升，微火煮取三升。',
  '主治: 太阳中风',
  '证候要点: ["阳浮而阴弱"]',
  '禁忌: []',
  '含毒药物: ["[[附子]]"]',
  '安全等级: 未核',
  '核验状态: 待核',
  '证据定位: 原始资料/甲.txt:41；原始资料/乙.txt',
  '相关方剂: ["桂枝加葛根汤"]',
  '---',
  '',
  '## 煎服法',
  '咀三味，以水七升，微火煮取三升。',
].join('\n')

describe('convertClauseCard', () => {
  it('转换条文字段并提取原文引用块', () => {
    const result = convertClauseCard(cardOf('01_条文/太阳病/条文-012.md', CLAUSE_012))
    expect(result.warnings).toEqual([])
    expect(result.record).toEqual({
      number: 12,
      sixChannel: '太阳病',
      chapter: '辨太阳病脉证并治上',
      edition: '宋本',
      kangpingLayer: '原文',
      versionDisputed: false,
      formulaNames: ['桂枝汤'],
      symptomLabels: ['发热', '恶寒'],
      text: '太阳中风，阳浮而阴弱，……鼻鸣干呕者，桂枝汤主之。',
      verifyStatus: '待核',
      locator: '01_条文/太阳病/条文-012.md',
    })
  })

  it('非六经病名、文件名编号不一致、缺原文时记 warning', () => {
    const markdown = CLAUSE_012.replace('六经: 太阳病', '六经: 辨脉平脉').replace(/## 原文（宋版）\r\n> [^\r]*/, '')
    const result = convertClauseCard(cardOf('01_条文/辨脉平脉/条文-013.md', markdown))
    const messages = result.warnings.map((warning) => warning.message)
    expect(messages.some((message) => message.includes('不是六经病名'))).toBe(true)
    expect(messages.some((message) => message.includes('与文件名编号 13 不一致'))).toBe(true)
    expect(messages.some((message) => message.includes('缺少「## 原文」引用块'))).toBe(true)
    expect(result.record?.number).toBe(12)
    expect(result.record?.text).toBeNull()
  })

  it('缺条文号时回退文件名，二者皆无则跳过', () => {
    const withoutNumber = CLAUSE_012.replace('条文号: 12\r\n', '')
    expect(convertClauseCard(cardOf('01_条文/太阳病/条文-012.md', withoutNumber)).record?.number).toBe(12)
    const skipped = convertClauseCard(cardOf('01_条文/太阳病/杂项.md', withoutNumber))
    expect(skipped.record).toBeNull()
    expect(skipped.skipReason).toContain('条文号')
  })
})

describe('mapSourceBooks', () => {
  it('把出处映射为 bookId', () => {
    expect(mapSourceBooks('伤寒论')).toEqual({ bookIds: ['songben'], unmapped: [] })
    expect(mapSourceBooks('金匮要略')).toEqual({ bookIds: ['jingui'], unmapped: [] })
    expect(mapSourceBooks('桂林古本伤寒杂病论').bookIds).toEqual(['guilin'])
    expect(mapSourceBooks('桂林古本').bookIds).toEqual(['guilin'])
    expect(mapSourceBooks('金匮要略；桂林古本（条文）').bookIds).toEqual(['jingui', 'guilin'])
  })

  it('无法识别的片段单独返回，空值返回空数组', () => {
    expect(mapSourceBooks('千金要方；伤寒论')).toEqual({ bookIds: ['songben'], unmapped: ['千金要方'] })
    expect(mapSourceBooks(null)).toEqual({ bookIds: [], unmapped: [] })
  })
})

describe('alignFormulaHerbs', () => {
  it('按顺序对齐，剥离药名前缀并解析药物链接', () => {
    const { herbs, messages } = alignFormulaHerbs(
      ['桂枝', '[[瓜蒂]]'],
      ['桂枝三两去皮', '瓜蒂一分熬黄'],
      ['[[桂枝]]', '[[甜瓜蒂|瓜蒂]]'],
    )
    expect(messages).toEqual([])
    expect(herbs).toEqual([
      { name: '桂枝', doseRaw: '桂枝三两去皮', doseText: '三两去皮', herbCard: '桂枝', herbLinkNote: null },
      { name: '瓜蒂', doseRaw: '瓜蒂一分熬黄', doseText: '一分熬黄', herbCard: '甜瓜蒂', herbLinkNote: null },
    ])
  })

  it('剂量缺药名前缀与药名不一致分别记 warning', () => {
    const { herbs, messages } = alignFormulaHerbs(['枳实', '附子'], ['三枚炙', '大附子一枚'], [])
    expect(herbs.map((herb) => herb.doseText)).toEqual(['三枚炙', '大附子一枚'])
    expect(herbs.every((herb) => herb.herbCard === null)).toBe(true)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('未带药名前缀')
    expect(messages[0]).toContain('枳实=三枚炙')
    expect(messages[1]).toContain('附子≠「大附子一枚」')
  })

  it('数量不一致时补 null 并记 warning', () => {
    const { herbs, messages } = alignFormulaHerbs(['甘草', '干姜'], ['甘草二两', '干姜一两', '附子一枚'], ['[[甘草]]'])
    expect(herbs).toHaveLength(2)
    expect(messages.some((message) => message.includes('数量不一致，已按顺序对齐'))).toBe(true)
    expect(messages.some((message) => message.includes('herbCard 未对齐'))).toBe(true)
    expect(messages.some((message) => message.includes('多出未对齐项：附子一枚'))).toBe(true)
    const shorter = alignFormulaHerbs(['甘草', '干姜'], ['甘草二两'], [])
    expect(shorter.herbs[1].doseRaw).toBeNull()
  })
})

describe('convertFormulaCard', () => {
  it('转换方剂，煎服法不一致时两者都保留，不导出折算剂量', () => {
    const result = convertFormulaCard(cardOf('02_方剂/桂枝汤.md', FORMULA_GUIZHI))
    const record = result.record
    expect(record).not.toBeNull()
    if (!record) return
    expect(record.sourceBooks).toEqual(['songben'])
    expect(record.sourceRefsRaw).toEqual(['12', '13', '方1'])
    expect(record.clauseNumbers).toEqual([12, 13])
    expect(record.songbenFormulaNumbers).toEqual([1])
    expect(record.herbs[1]).toMatchObject({ name: '芍药', doseText: '三两', herbCard: '陈皮' })
    expect(record.herbs[2]).toMatchObject({ name: '瓜蒂', herbCard: null, herbLinkNote: '蜂蜜（食材/辅料，不建药物卡）' })
    expect(record.preparation).toBe('以水七升，微火煮取三升。')
    expect(record.preparationBody).toBe('咀三味，以水七升，微火煮取三升。')
    expect(record.toxicHerbs).toEqual(['附子'])
    expect(record.evidenceLocators).toEqual([
      { path: '原始资料/甲.txt', line: 41 },
      { path: '原始资料/乙.txt', line: null },
    ])
    expect(record.hasConvertedDose).toBe(true)
    expect(JSON.stringify(record)).not.toContain('45g')
    const messages = result.warnings.map((warning) => warning.message)
    expect(messages.some((message) => message.includes('煎服法与正文'))).toBe(true)
    expect(messages.some((message) => message.includes('未带药名前缀'))).toBe(true)
    expect(messages.some((message) => message.includes('瓜蒂≠「大瓜蒂一分」'))).toBe(true)
  })

  it('煎服法仅空白差异视为一致；出处不含伤寒论时不解析宋本编号', () => {
    const markdown = FORMULA_GUIZHI.replace('出处: 伤寒论', '出处: 金匮要略').replace(
      '咀三味，以水七升，微火煮取三升。',
      '以水七升，\n微火煮取三升。',
    )
    const result = convertFormulaCard(cardOf('02_方剂/桂枝汤.md', markdown))
    expect(result.record?.preparationBody).toBeNull()
    expect(result.record?.clauseNumbers).toEqual([])
    expect(result.warnings.some((warning) => warning.message.includes('不含伤寒论'))).toBe(true)
  })

  it('缺必需字段时记 warning 并以文件名兜底方名', () => {
    const result = convertFormulaCard(cardOf('02_方剂/某方.md', '---\ntype: 方剂\n---\n'))
    expect(result.record?.name).toBe('某方')
    const messages = result.warnings.map((warning) => warning.message)
    expect(messages).toContain('缺少必需字段「方名」')
    expect(messages).toContain('缺少必需字段「组成」')
    expect(messages).toContain('组成为空')
  })
})

describe('parseFormulaSourceRefs / splitEvidenceLocators', () => {
  it('只把纯数字和 方N 识别为宋本编号', () => {
    expect(parseFormulaSourceRefs(['71', '方96', '金匮 76', '桂林古本 5.10', '15.2', '71'])).toEqual({
      clauseNumbers: [71],
      songbenFormulaNumbers: [96],
    })
  })

  it('空证据定位返回空数组', () => {
    expect(splitEvidenceLocators(null)).toEqual([])
    expect(splitEvidenceLocators(' ； ')).toEqual([])
  })
})

describe('convertHerbCard / normalizeTermList', () => {
  it('含毒 待核 → null，归经拆分去「经」，全待核列表为 null', () => {
    const markdown = [
      '---',
      'type: 药物',
      '药名: 白石脂',
      '药典名: 待核',
      '别名: []',
      '拼音: Baishizhi',
      '拉丁名: 待核',
      '性味: [待核]',
      '归经: ["肺、胃、大肠经"]',
      '含毒: 待核',
      '现代常用量: 6～12g',
      '数据来源:',
      '  剂量与性味: 中国药典2020年版一部·待核',
      '---',
    ].join('\n')
    const result = convertHerbCard(cardOf('03_药物/白石脂.md', markdown))
    expect(result.record).toMatchObject({
      name: '白石脂',
      pharmacopoeiaName: null,
      latin: null,
      natureFlavor: null,
      channels: ['肺', '胃', '大肠'],
      toxic: null,
      modernDose: '6～12g',
      sources: [{ kind: '剂量与性味', text: '中国药典2020年版一部·待核' }],
      verifyStatus: null,
    })
    const messages = result.warnings.map((warning) => warning.message)
    expect(messages).toContain('缺少必需字段「核验状态」')
    expect(messages.some((message) => message.includes('归经项内含分隔符'))).toBe(true)
  })

  it('normalizeTermList 保留空列表为空数组并去重', () => {
    expect(normalizeTermList([])).toEqual({ terms: [], splitApplied: false })
    expect(normalizeTermList(['苦、辛', '辛', '待核'])).toEqual({ terms: ['苦', '辛'], splitApplied: true })
    expect(normalizeTermList(['经'], '经').terms).toEqual(['经'])
  })
})

describe('convertSyndromeCard', () => {
  it('解析关联条文号、舌脉与鉴别要点', () => {
    const markdown = [
      '---',
      'type: 证型',
      '证名: 太阳中风证',
      '六经: 太阳病',
      '病性: [表, 虚]',
      '主方: ["[[桂枝汤]]"]',
      '关联条文: ["[[01_条文/太阳病/条文-013|条文-013]]", "[[01_条文/太阳病/条文-012|条文-012]]"]',
      '主症: [发热, 汗出]',
      '舌脉: {脉: 浮缓, 舌: 苔薄白}',
      '鉴别证型: ["[[太阳伤寒证]]"]',
      '鉴别要点: {太阳伤寒证: "无汗而喘", 阳明病: "多出的条目"}',
      '---',
      '## 定义',
      '太阳表虚，营卫不和，见[[桂枝汤]]证。',
    ].join('\n')
    const result = convertSyndromeCard(cardOf('04_证型/太阳病/太阳中风证.md', markdown))
    expect(result.record).toMatchObject({
      name: '太阳中风证',
      mainFormulas: ['桂枝汤'],
      clauseNumbers: [12, 13],
      tongueAndPulse: { pulse: '浮缓', tongue: '苔薄白' },
      differentials: [
        { target: '太阳伤寒证', note: '无汗而喘' },
        { target: '阳明病', note: '多出的条目' },
      ],
      definition: '太阳表虚，营卫不和，见桂枝汤证。',
    })
    expect(result.warnings.map((warning) => warning.message)).toEqual(['鉴别要点含鉴别证型之外的条目：阳明病'])
  })
})

describe('convertCommentaryCard', () => {
  const COMMENTARY = [
    '---',
    'type: 解读',
    '解读家: 尤怡',
    '来源: 伤寒贯珠集',
    '关联条文: ["[[01_条文/太阳病/条文-012|条文-012]]"]',
    '关联方剂: ["[[桂枝汤]]"]',
    '---',
    '## 解读提要',
    '- 尤怡以“阳受风气而未及乎阴”解释阳浮阴弱。',
    '- [[桂枝汤]] 之意在助正逐邪。',
    '',
    '## 原文依据',
    '- 《伤寒贯珠集》云：`太陽中風者。陽受風氣而未及乎陰也。`',
    '- 又云：`是宜桂枝湯助正以逐邪。`',
  ].join('\r\n')

  it('提取反引号原句与解读提要，并标记 licenseRestricted', () => {
    const result = convertCommentaryCard(cardOf('99_解读/注家/尤怡/条文-012.md', COMMENTARY))
    expect(result.warnings).toEqual([])
    expect(result.record).toEqual({
      commentator: '尤怡',
      sourceBook: '伤寒贯珠集',
      clauseNumber: 12,
      formulaNames: ['桂枝汤'],
      quotes: ['太陽中風者。陽受風氣而未及乎陰也。', '是宜桂枝湯助正以逐邪。'],
      summary: '尤怡以“阳受风气而未及乎阴”解释阳浮阴弱。\n桂枝汤 之意在助正逐邪。',
      status: null,
      licenseRestricted: true,
      locator: '99_解读/注家/尤怡/条文-012.md',
    })
  })

  it('关联条文与文件名不一致时记 warning', () => {
    const result = convertCommentaryCard(cardOf('99_解读/注家/尤怡/条文-013.md', COMMENTARY))
    expect(result.warnings.some((warning) => warning.message.includes('与文件名编号 13 不一致'))).toBe(true)
  })
})

describe('checkClauseSequence', () => {
  it('完整 1..398 无问题', () => {
    const numbers = Array.from({ length: SONGBEN_CLAUSE_LAST }, (_unused, index) => index + 1)
    expect(checkClauseSequence(numbers)).toEqual([])
  })

  it('报告重复、缺失与越界', () => {
    const numbers = Array.from({ length: SONGBEN_CLAUSE_LAST }, (_unused, index) => index + 1)
      .filter((value) => value !== 5)
      .concat([7, 400])
    const problems = checkClauseSequence(numbers)
    expect(problems).toEqual(['条文号重复：7', '条文号缺失：5', '条文号超出 1..398：400'])
  })
})

describe('buildKbDataset', () => {
  it('无 frontmatter、YAML 错误、type 不符的卡片记入 skipped，其余照常转换', () => {
    const dataset = buildKbDataset([
      { section: 'formulas', locator: '02_方剂/方剂清单.md', text: '# 方剂清单\n- 桂枝汤' },
      { section: 'formulas', locator: '02_方剂/坏卡.md', text: '---\n方名: [未闭合\n---\n' },
      { section: 'formulas', locator: '02_方剂/模板.md', text: '---\ntype: 模板\n---\n' },
      { section: 'formulas', locator: '02_方剂/桂枝汤.md', text: FORMULA_GUIZHI },
    ])
    expect(dataset.formulas.map((formula) => formula.name)).toEqual(['桂枝汤'])
    expect(dataset.skipped.map((item) => item.path).sort()).toEqual([
      '02_方剂/坏卡.md',
      '02_方剂/方剂清单.md',
      '02_方剂/模板.md',
    ])
    const reasons = Object.fromEntries(dataset.skipped.map((item) => [item.path, item.reason]))
    expect(reasons['02_方剂/方剂清单.md']).toBe('无 frontmatter')
    expect(reasons['02_方剂/坏卡.md']).toContain('YAML 解析失败')
    expect(reasons['02_方剂/模板.md']).toContain('期望「方剂」')
  })

  it('条文按编号排序，并对缺号记集合级 warning', () => {
    const dataset = buildKbDataset([
      { section: 'clauses', locator: '01_条文/太阳病/条文-013.md', text: CLAUSE_012.replace('条文号: 12', '条文号: 13') },
      { section: 'clauses', locator: '01_条文/太阳病/条文-012.md', text: CLAUSE_012 },
    ])
    expect(dataset.clauses.map((clause) => clause.number)).toEqual([12, 13])
    const collectionWarning = dataset.warnings.find((warning) => warning.path === '01_条文')
    expect(collectionWarning?.message).toMatch(/^条文号缺失：1、2、/)
  })

  it('同名方剂记重复 warning', () => {
    const dataset = buildKbDataset([
      { section: 'formulas', locator: '02_方剂/桂枝汤.md', text: FORMULA_GUIZHI },
      { section: 'formulas', locator: '02_方剂/甲/桂枝汤.md', text: FORMULA_GUIZHI },
    ])
    expect(dataset.warnings.some((warning) => warning.message.startsWith('方名「桂枝汤」重复'))).toBe(true)
  })
})
