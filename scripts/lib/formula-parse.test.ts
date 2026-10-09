import { describe, expect, it } from 'vitest'
import {
  FANG_HEADING_NAME_ENDINGS,
  applyEqualDoseFromPreparation,
  applyGeDosePropagation,
  extractFormulaBlocks,
  isFormulaNameLine,
  mergeDetachedDoses,
  mergeProcessingOrphans,
  parseFormulaHeading,
  parseHerbLine,
  parseModifications,
  parseSingleHerbDescription,
  recoverKnownHerb,
  repairUnopenedParen,
  splitGluedHerbToken,
  splitGluedKnownHerbNames,
  splitHerbLine,
  splitInlineHerbPreparation,
} from './formula-parse.ts'
import { toSimplifiedChinese } from './wiki.ts'

describe('formula-parse processing', () => {
  it('keeps spaces inside parentheses when splitting', () => {
    const tokens = splitHerbLine('乌头一两(炮) 蜀椒一两 附子半两（炮 去皮） 干姜一两 赤石脂一两')
    expect(tokens).toEqual([
      '乌头一两(炮)',
      '蜀椒一两',
      '附子半两（炮 去皮）',
      '干姜一两',
      '赤石脂一两',
    ])
  })

  it('parses 乌头赤石脂丸 without treating 去皮 as a herb', () => {
    const herbs = parseHerbLine('乌头一两(炮) 蜀椒一两 附子半两（炮 去皮） 干姜一两 赤石脂一两')
    expect(herbs.map((herb) => herb.name)).toEqual(['乌头', '花椒', '附子', '干姜', '赤石脂'])
    const fuzi = herbs.find((herb) => herb.name === '附子')
    expect(fuzi?.processing).toContain('炮')
    expect(fuzi?.processing).toContain('去皮')
  })

  it('parses multi-processing notes on fuzi', () => {
    const herbs = parseHerbLine('附子一枚（炮 去皮 破八片）')
    expect(herbs).toHaveLength(1)
    expect(herbs[0]?.name).toBe('附子')
    expect(herbs[0]?.processing).toMatch(/炮/)
    expect(herbs[0]?.processing).toMatch(/去皮/)
  })

  it('merges already-broken processing orphans', () => {
    expect(mergeProcessingOrphans(['附子半两（炮', '去皮）', '干姜一两'])).toEqual([
      '附子半两（炮 去皮）',
      '干姜一两',
    ])
  })

  it('does not create herb named 熬', () => {
    const herbs = parseHerbLine('葶苈子半升（熬） 杏仁半升（去皮尖）')
    expect(herbs.map((herb) => herb.name)).toEqual(['葶苈子', '杏仁'])
    expect(herbs.some((herb) => herb.name === '熬' || herb.name === '去皮')).toBe(false)
  })

  it('propagates 各一两 to preceding herbs in 桂枝麻黄各半汤', () => {
    const line =
      '桂枝一两十六铢（去皮） 芍药 生姜（切） 甘草（炙） 麻黄（去节）各一两 大枣四枚（擘）杏仁二十四枚（汤浸，去皮尖及两仁者）'
    expect(applyGeDosePropagation(splitHerbLine(line))).toEqual([
      '桂枝一两十六铢（去皮）',
      '芍药一两',
      '生姜一两（切）',
      '甘草一两（炙）',
      '麻黄一两（去节）',
      '大枣四枚（擘）',
      '杏仁二十四枚（汤浸，去皮尖及两仁者）',
    ])
    const herbs = parseHerbLine(line)
    expect(herbs.find((herb) => herb.name === '芍药')?.doseRaw).toBe('一两')
    expect(herbs.find((herb) => herb.name === '生姜')?.doseRaw).toBe('一两')
    expect(herbs.find((herb) => herb.name === '甘草')?.doseRaw).toBe('一两')
    expect(herbs.find((herb) => herb.name === '麻黄')?.doseRaw).toBe('一两')
    expect(herbs.find((herb) => herb.name === '杏仁')?.doseRaw).toBe('二十四枚')
  })

  it('propagates 各三两 across small qinglong style lines', () => {
    const herbs = parseHerbLine(
      '麻黄（去节） 芍药 细辛 干姜 甘草（炙） 桂枝（去皮）各三两 五味子半升 半夏（洗）半升',
    )
    for (const name of ['麻黄', '芍药', '细辛', '干姜', '甘草', '桂枝']) {
      expect(herbs.find((herb) => herb.name === name)?.doseRaw).toBe('三两')
    }
    expect(herbs.find((herb) => herb.name === '五味子')?.doseRaw).toBe('半升')
  })

  it('propagates trailing 各三两 after space-separated herbs', () => {
    const herbs = parseHerbLine('人参 干姜 甘草（炙） 白术各三两')
    for (const name of ['人参', '干姜', '甘草', '白术']) {
      expect(herbs.find((herb) => herb.name === name)?.doseRaw).toBe('三两')
    }
  })

  it('propagates 各等分', () => {
    const herbs = parseHerbLine(
      '牡蛎（熬） 泽泻 蜀漆（暖水洗去腥） 葶苈子（熬） 商陆根（熬） 海藻（洗去咸） 栝蒌根各等分',
    )
    expect(herbs.every((herb) => herb.doseRaw === '等分')).toBe(true)
  })

  it('does not split 升麻 on unit 升', () => {
    const herbs = parseHerbLine(
      '麻黄二两半（去节）　升麻一两一分　当归一两一分　知母十八株　黄芩十八株',
    )
    expect(herbs.map((herb) => herb.name)).toEqual([
      '麻黄',
      '升麻',
      '当归',
      '知母',
      '黄芩',
    ])
    expect(herbs.find((herb) => herb.name === '升麻')?.doseRaw).toBe('一两一分')
  })

  it('normalizes 两檗 to 黄檗 with dose', () => {
    const herbs = parseHerbLine('白头翁二两　两檗三两，黄连三两　秦皮三两')
    expect(herbs.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual([
      '白头翁:二两',
      '黄檗:三两',
      '黄连:三两',
      '秦皮:三两',
    ])
  })

  it('parses omitted 一 in 干姜两半', () => {
    const herbs = parseHerbLine('甘草二两（灸）　附子一枚（生，去皮，破八片）　干姜两半，人参一两')
    expect(herbs.find((herb) => herb.name === '干姜')?.doseRaw).toBe('一两半')
    expect(herbs.find((herb) => herb.name === '干姜')?.doseLiang).toBe(1.5)
  })

  it('maps 芎䓖 to 川芎 with dose', () => {
    const herbs = parseHerbLine('甘草　芎䓖　当归各二两　半夏四两')
    expect(herbs.find((herb) => herb.name === '川芎')?.doseRaw).toBe('二两')
    expect(herbs.some((herb) => herb.name === '芎')).toBe(false)
  })

  it('peels 去目汗 and keeps 花椒', () => {
    const herbs = parseHerbLine('蜀椒二合去目汗 干姜四两')
    expect(herbs.map((herb) => herb.name)).toEqual(['花椒', '干姜'])
    expect(herbs[0]?.processing).toMatch(/去目/)
    expect(herbs.some((herb) => herb.name === '去目汗')).toBe(false)
  })

  it('does not split 为膏 after 大枣百枚', () => {
    const tokens = splitHerbLine('大枣百枚为膏')
    expect(tokens).toEqual(['大枣百枚为膏'])
  })

  it('propagates 等分 without 各', () => {
    const herbs = parseHerbLine('栝蒌根　牡蛎熬等分')
    expect(herbs.every((herb) => herb.doseRaw === '等分')).toBe(true)
    expect(herbs.map((herb) => herb.name)).toEqual(['天花粉', '牡蛎'])
  })

  it('keeps 去皮尖 together for 桃仁', () => {
    const herbs = parseHerbLine('桂枝　茯苓　牡丹去心　桃仁去皮、尖，熬　芍药各等分')
    expect(herbs.some((herb) => herb.name === '尖')).toBe(false)
    expect(herbs.find((herb) => herb.name === '桃仁' || herb.rawText.includes('桃仁'))).toBeTruthy()
  })

  it('propagates standalone 各等分 marker', () => {
    const herbs = parseHerbLine('半夏(洗) 麻黄(去节) 各等分')
    expect(herbs).toHaveLength(2)
    expect(herbs.every((herb) => herb.doseRaw === '等分')).toBe(true)
  })

  it('treats 大者 as note not herb', () => {
    const herbs = parseHerbLine('大黄四两 厚朴二两（炙） 枳实三枚大者')
    expect(herbs.map((herb) => herb.name)).toEqual(['大黄', '厚朴', '枳实'])
    expect(herbs.find((herb) => herb.name === '枳实')?.doseRaw).toBe('三枚')
  })

  it('peels 大者 before dose on 附子', () => {
    const herbs = parseHerbLine('附子大者一枚（炮）')
    expect(herbs).toHaveLength(1)
    expect(herbs[0]?.name).toBe('附子')
    expect(herbs[0]?.doseRaw).toBe('一枚')
  })

  it('keeps 百合知母汤 herb line before prep', () => {
    const blocks = extractFormulaBlocks(
      ['百合知母汤方：', '百合七枚（擘）　知母三两（切）', '上先以水洗百合，渍一宿，去滓'].join('\n'),
    )
    expect(blocks[0]?.herbs.map((herb) => herb.name)).toEqual(['百合', '知母'])
  })
})

describe('formula-parse 金匮修复（共用规则）', () => {
  it('repairUnopenedParen 在剂量后补左括号', () => {
    expect(repairUnopenedParen('甘草三两（炙） 川乌五枚㕮咀，以蜜二升，煎取一升，即出乌头）')).toBe(
      '甘草三两（炙） 川乌五枚（㕮咀，以蜜二升，煎取一升，即出乌头）',
    )
    // 括号配对完整时原样返回
    expect(repairUnopenedParen('附子一枚（炮）')).toBe('附子一枚（炮）')
  })

  it('括号注语里的「煎取」不让整味药被当成煎服法丢掉', () => {
    const herbs = parseHerbLine(
      '麻黄　芍药　黄耆各三两　甘草三两（炙）　川乌五枚㕮咀，以蜜二升，煎取一升，即出乌头）',
    )
    expect(herbs.map((herb) => herb.name)).toEqual(['麻黄', '芍药', '黄芪', '甘草', '川乌'])
    expect(herbs.find((herb) => herb.name === '川乌')?.doseRaw).toBe('五枚')
  })

  it('连续炮制碎片并入上一味（炙焦 / 去皮子）', () => {
    const herbs = parseHerbLine('皂荚二枚，去皮子，炙焦。')
    expect(herbs.map((herb) => herb.name)).toEqual(['皂荚'])
  })

  it('方名后的主治行记为 indication，不当药味', () => {
    const [block] = extractFormulaBlocks(
      ['乌头汤方', '治脚气疼痛，不可屈伸。', '麻黄三两 芍药三两', '上二味，以水三升，煮取一升。'].join('\n'),
    )
    expect(block?.indication).toBe('治脚气疼痛，不可屈伸。')
    expect(block?.herbs.map((herb) => herb.name)).toEqual(['麻黄', '芍药'])
  })

  it('requireKnownHerb：不可解析的药名移入 unresolvedHerbTokens', () => {
    const text = ['柴胡饮子方', '白术八分 陈皮五分 减白术共六味', '右各㕮咀，分为三贴。'].join('\n')
    const [loose] = extractFormulaBlocks(text)
    const [strict] = extractFormulaBlocks(text, { requireKnownHerb: true })
    expect(strict?.herbs.map((herb) => herb.name)).toEqual(['白术', '陈皮'])
    expect(strict?.unresolvedHerbTokens).toEqual(['减白术共六味'])
    // 默认不开启时保持旧行为：herbs 不被过滤，但诊断同样产出
    expect(loose?.herbs.length).toBeGreaterThan(strict?.herbs.length ?? 0)
    expect(loose?.unresolvedHerbTokens).toEqual(['减白术共六味'])
  })

  it('recoverKnownHerb 剥掉粘连的数量词 / 炮制词', () => {
    const counted = recoverKnownHerb({ herbId: '獭肝一具', name: '獭肝一具', rawText: '獭肝一具', doseRaw: '' })
    expect(counted?.name).toBe('獭肝')
    expect(counted?.doseRaw).toBe('一具')
    const processed = recoverKnownHerb({
      herbId: '附子炮去皮',
      name: '附子炮去皮',
      rawText: '附子炮去皮四分',
      doseRaw: '四分',
    })
    expect(processed?.name).toBe('附子')
    expect(processed?.doseRaw).toBe('四分')
    expect(processed?.processing).toMatch(/炮/)
    expect(
      recoverKnownHerb({ herbId: '春三月加枳实', name: '春三月加枳实', rawText: '春三月加枳实', doseRaw: '' }),
    ).toBeNull()
  })

  it('stopAtBlankLineAfterPreparation：煎服法后空行即结束本方', () => {
    const text = [
      '赤石脂丸方',
      '',
      '蜀椒一两；乌头一分；赤石脂一两。',
      '',
      '右三味，末之，蜜丸如梧子大。',
      '',
      '心痛彻背，背痛彻心者，宜此方。',
    ].join('\n')
    const [block] = extractFormulaBlocks(text, { stopAtBlankLineAfterPreparation: true })
    expect(block?.herbs.map((herb) => herb.name)).toEqual(['花椒', '乌头', '赤石脂'])
    expect(block?.preparation).toBe('右三味，末之，蜜丸如梧子大。')
  })

  it('煎服法中的「皆主之」不截断煎服法', () => {
    const [block] = extractFormulaBlocks(
      ['当归散方', '当归一斤 黄芩一斤 白术半斤', '右三味，杵为散，酒饮服方寸匕。产后百病悉主之。'].join('\n'),
    )
    expect(block?.preparation).toContain('悉主之')
  })

  it('仅一味有剂量时，不把剂量回填到其后的无剂量药味', () => {
    const [block] = extractFormulaBlocks(
      ['赤豆当归散方', '赤小豆三升（浸，令芽出，曝干） 当归', '上二味，杵为散，浆水服方寸匕。'].join('\n'),
    )
    expect(block?.herbs.find((herb) => herb.name === '当归')?.doseRaw ?? '').toBe('')
    // 「葵子，茯苓三两」：无剂量者在前，仍按省文回填
    const [kuizi] = extractFormulaBlocks(
      ['葵子茯苓散方', '葵子，茯苓三两。', '右二味，杵为散。'].join('\n'),
    )
    expect(kuizi?.herbs.map((herb) => herb.doseRaw)).toEqual(['三两', '三两'])
  })
})

describe('formula-parse 伤寒论交叉比对所报解析 bug', () => {
  const danggui = {
    name: '当归四逆加吴茱萸生姜汤方',
    herbLine:
      '当归三两　芍药三两　甘草二两（炙）　通草二两　大枣二十五枚（孽）　桂枝三两（去皮）　细辛　三两　生姜半斤（切）　吴茱萸二升',
    preparation: '上九味，以水六升、清酒六升和，煮取五升，去滓，温分五服（一方，水酒各四升）。',
  }

  it('煎服法里「水酒各四升」是溶剂用量，不回填给无剂量药味', () => {
    // 模拟细辛未取到剂量：回填只认指向药物的「各」
    const herbs = parseHerbLine(danggui.herbLine.replace('细辛　三两', '细辛'))
    expect(herbs.find((herb) => herb.name === '细辛')?.doseRaw).toBe('')
    const filled = applyEqualDoseFromPreparation(herbs, danggui.preparation)
    expect(filled.find((herb) => herb.name === '细辛')?.doseRaw).toBe('')
    // 宋本另一处写法：「一方水酒各四升」在句号之后
    const alternative = applyEqualDoseFromPreparation(
      herbs,
      '上九味，以水六升，清酒六升，和煮取五升，去滓，温分五服。一方水酒各四升。',
    )
    expect(alternative.find((herb) => herb.name === '细辛')?.doseRaw).toBe('')
  })

  it('溶剂「各」之后指向药物的「各×分 / 各等分」仍回填', () => {
    const herbs = parseHerbLine('桂枝　茯苓　芍药')
    const fen = applyEqualDoseFromPreparation(herbs, '上三味，以水、酒各一升，各十分，杵为散。')
    expect(fen.map((herb) => herb.doseRaw)).toEqual(['十分', '十分', '十分'])
    const equal = applyEqualDoseFromPreparation(herbs, '上三味，各等分，水酒各半煎。')
    expect(equal.map((herb) => herb.doseRaw)).toEqual(['等分', '等分', '等分'])
    // 只有溶剂等分：不回填
    const solventOnly = applyEqualDoseFromPreparation(herbs, '上三味，以水酒各等分煎。')
    expect(solventOnly.map((herb) => herb.doseRaw)).toEqual(['', '', ''])
    // 原有规则不变
    const plain = applyEqualDoseFromPreparation(herbs, '上三味，各十分，杵为散。')
    expect(plain.map((herb) => herb.doseRaw)).toEqual(['十分', '十分', '十分'])
  })

  it('「细辛　三两」：药名与剂量之间的全角 / 半角空格不拆成两项', () => {
    const herbs = parseHerbLine(danggui.herbLine)
    expect(herbs).toHaveLength(9)
    expect(herbs.find((herb) => herb.name === '细辛')).toMatchObject({ doseRaw: '三两', doseLiang: 3 })
    expect(parseHerbLine('細辛 三兩').map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual(['细辛:三两'])
    const [block] = extractFormulaBlocks([danggui.name, danggui.herbLine, danggui.preparation].join('\n'))
    expect(block?.herbs.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual([
      '当归:三两',
      '芍药:三两',
      '甘草:二两',
      '通草:二两',
      '大枣:二十五枚',
      '桂枝:三两',
      '细辛:三两',
      '生姜:半斤',
      '吴茱萸:二升',
    ])
  })

  it('孤立剂量的并回规则：带炮制注、上一味已有剂量、百合', () => {
    expect(mergeDetachedDoses(['甘草（炙）', '二两'])).toEqual(['甘草二两（炙）'])
    expect(mergeDetachedDoses(['甘草', '二两（炙）'])).toEqual(['甘草二两（炙）'])
    // 上一味已有剂量：不并
    expect(mergeDetachedDoses(['人参二钱', '五分'])).toEqual(['人参二钱', '五分'])
    // 「百合」不是「百 + 合」剂量
    expect(mergeDetachedDoses(['知母', '百合'])).toEqual(['知母', '百合'])
    // 「各三两」交给各剂量回填
    expect(mergeDetachedDoses(['白术', '各三两'])).toEqual(['白术', '各三两'])
    // 上一味不是药名：不并
    expect(mergeDetachedDoses(['上九味', '三两'])).toEqual(['上九味', '三两'])
  })

  it('「（切）半夏」：括号炮制注归前一味，后接数字起首的药名独立成项', () => {
    const gegen = parseHerbLine(
      '葛根四两　麻黄三两（去节）　甘草二两（炙）　芍药二两　桂枝二两（去皮）　生姜二两（切）半夏半升（洗）　大枣十二枚（擘）',
    )
    expect(gegen.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual([
      '葛根:四两',
      '麻黄:三两',
      '甘草:二两',
      '芍药:二两',
      '桂枝:二两',
      '生姜:二两',
      '半夏:半升',
      '大枣:十二枚',
    ])
    expect(gegen.find((herb) => herb.name === '生姜')?.processing).toBe('切')
    expect(gegen.find((herb) => herb.name === '半夏')?.processing).toBe('洗')
    // 桂林古本厚朴四物汤
    const houpo = parseHerbLine('厚朴二两（炙） 枳实三枚（炙）半夏半升（洗） 橘皮一两')
    expect(houpo.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual([
      '厚朴:二两',
      '枳实:三枚',
      '半夏:半升',
      '陈皮:一两',
    ])
  })

  it('剂量续写不被当成数字起首的药名', () => {
    expect(splitGluedHerbToken('桂枝一两十六铢（去皮）')).toEqual(['桂枝一两十六铢（去皮）'])
    expect(splitGluedHerbToken('附子（炮）半两')).toEqual(['附子（炮）半两'])
    expect(splitGluedHerbToken('人参三两五味子半升')).toEqual(['人参三两', '五味子半升'])
  })

  it('猪苓汤「泽泻阿胶」：原文漏刻分隔的两味已知药拆开，五味各一两', () => {
    const [block] = extractFormulaBlocks(
      [
        '猪苓汤方',
        '猪苓（去皮）　茯苓　泽泻阿胶　滑石（碎）各一两',
        '上五味，以水四升，先煮四味取二升，去滓，内阿胶烊消，温服七合，日三服。',
      ].join('\n'),
    )
    expect(block?.herbs.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual([
      '猪苓:一两',
      '茯苓:一两',
      '泽泻:一两',
      '阿胶:一两',
      '滑石:一两',
    ])
    expect(block?.unresolvedHerbTokens).toEqual([])
  })

  it('粘连药名只在能完整切成已知药名时才拆', () => {
    expect(splitGluedKnownHerbNames('泽泻阿胶（炙）')).toEqual(['泽泻', '阿胶（炙）'])
    // 本身是已知药名 / 有剂量 / 切不尽：保持原样
    expect(splitGluedKnownHerbNames('白头翁')).toEqual(['白头翁'])
    expect(splitGluedKnownHerbNames('生姜汁')).toEqual(['生姜汁'])
    expect(splitGluedKnownHerbNames('泽泻阿胶一两')).toEqual(['泽泻阿胶一两'])
    expect(splitGluedKnownHerbNames('妇人中裈近隐处')).toEqual(['妇人中裈近隐处'])
    // 只取最长匹配、不回溯：不能切成别名「山茱」+「萸肉」
    expect(splitGluedKnownHerbNames('山茱萸肉')).toEqual(['山茱萸肉'])
    expect(splitGluedKnownHerbNames('续断细辛')).toEqual(['续断', '细辛'])
  })

  it('药名含扩展区汉字时，孤立剂量接在药名末尾而不是插进药名中间', () => {
    // 外台「茵蔯蒿末（十分）」：「蔯」简化后落在 BMP 之外
    const name = toSimplifiedChinese('茵蔯蒿末')
    expect(mergeDetachedDoses([name, '十分'])).toEqual([`${name}十分`])
  })
})

describe('formula-parse 宋本附方（「…方」小标题）', () => {
  it('接受以 汁 / 导 / 煎 / 根 结尾的「…方」小标题，可带校注', () => {
    expect(parseFormulaHeading('猪胆汁方（附方）')).toEqual({ name: '猪胆汁', headingNote: '附方', lost: false })
    expect(parseFormulaHeading('蜜煎导方')).toEqual({ name: '蜜煎导', lost: false })
    expect(parseFormulaHeading('蜜煎導方')).toEqual({ name: '蜜煎导', lost: false })
    expect(parseFormulaHeading('土瓜根方（附方佚）')).toEqual({ name: '土瓜根', headingNote: '附方佚', lost: true })
    // 原有汤散丸方名不受影响
    expect(parseFormulaHeading('桂枝汤方')).toEqual({ name: '桂枝汤', lost: false })
    for (const ending of FANG_HEADING_NAME_ENDINGS) {
      expect(isFormulaNameLine(`某某${ending}方`)).toBe(true)
    }
  })

  it('叙述句、药名行、动词起首的残句不当方名', () => {
    for (const line of [
      '若土瓜根及大猪胆汁，皆可为导。',
      '宜蜜煎导而通之',
      '宜蜜煎导方',
      '取汁方',
      '以猪胆汁方',
      '治小儿吐血地黄汁方',
      '此猪胆汁方也',
      '猪胆汁',
      '葛根',
      '猪胆汁根汁导方煎根汁导方',
    ]) {
      expect(parseFormulaHeading(line), line).toBeNull()
    }
  })

  it('原方佚：只建模方名，不吞并下一方', () => {
    const blocks = extractFormulaBlocks(
      [
        '土瓜根方（附方佚）',
        '猪胆汁方（附方）',
        '大猪胆一枚，泻汁，和少许法醋，以灌谷道内。如一食顷，当大便出宿食恶物，甚效。',
      ].join('\n'),
    )
    expect(blocks.map((block) => block.name)).toEqual(['土瓜根', '猪胆汁'])
    expect(blocks[0]).toMatchObject({ herbs: [], preparation: '', lost: true, headingNote: '附方佚' })
  })

  it('药味与制法同行：拆成一味药 + 煎服法', () => {
    const [block] = extractFormulaBlocks(
      ['猪胆汁方（附方）', '大猪胆一枚，泻汁，和少许法醋，以灌谷道内。如一食顷，当大便出宿食恶物，甚效。'].join('\n'),
    )
    expect(block?.herbs.map((herb) => herb.name)).toEqual(['大猪胆'])
    expect(block?.herbs[0]).toMatchObject({ doseRaw: '一枚', processing: '泻汁', rawText: '大猪胆一枚，泻汁' })
    expect(block?.preparation).toBe('和少许法醋，以灌谷道内。如一食顷，当大便出宿食恶物，甚效。')
    expect(block?.sourceLines).toEqual([
      '猪胆汁方（附方）',
      '大猪胆一枚，泻汁，和少许法醋，以灌谷道内。如一食顷，当大便出宿食恶物，甚效。',
    ])
  })

  it('普通药味行不被当成「药+制法」同行', () => {
    expect(splitInlineHerbPreparation('茯苓四两，桂枝三两，白术二两。')).toBeNull()
    expect(splitInlineHerbPreparation('甘草二两，炙。')).toBeNull()
    // 无句号的药列
    expect(splitInlineHerbPreparation('大猪胆一枚，和少许法醋')).toBeNull()
    // 制法里出现第二味带剂量的药
    expect(splitInlineHerbPreparation('大猪胆一枚，以水二升，内甘草二两，煮取一升。')).toBeNull()
  })

  it('蜜煎导方：食蜜一味', () => {
    const [block] = extractFormulaBlocks(
      ['蜜煎导方', '食蜜七合', '上一味。于铜器内，微火煎，当须凝如饴状。'].join('\n'),
    )
    expect(block?.name).toBe('蜜煎导')
    expect(block?.herbs.map((herb) => `${herb.name}:${herb.doseRaw}`)).toEqual(['食蜜:七合'])
  })
})

describe('formula-parse 单味描述行（「上一味」）', () => {
  it('烧裈散：妇人中裈近隐处，取烧作灰', () => {
    const [block] = extractFormulaBlocks(
      ['烧裈散方', '妇人中裈近隐处，取烧作灰。', '上一味，水服方寸匕。日三服。'].join('\n'),
    )
    expect(block?.herbs).toEqual([
      {
        herbId: '妇人中裈',
        name: '妇人中裈',
        rawText: '妇人中裈近隐处，取烧作灰。',
        doseRaw: '',
        processing: '近隐处，取烧作灰',
      },
    ])
  })

  it('行首不是已知药名时不猜测', () => {
    expect(parseSingleHerbDescription('某物近隐处，取烧作灰。')).toBeNull()
    // 只认原文写法，不走别名模糊匹配
    expect(parseSingleHerbDescription('黄耆近隐处，取烧作灰。')).toBeNull()
    expect(parseSingleHerbDescription('妇人中裈近隐处，取烧作灰。')?.name).toBe('妇人中裈')
  })

  it('煎服法不是「上一味」时不启用', () => {
    const [block] = extractFormulaBlocks(
      ['烧裈散方', '妇人中裈近隐处，取烧作灰。', '上二味，水服方寸匕。'].join('\n'),
    )
    expect(block?.herbs).toEqual([])
  })
})

describe('parseModifications', () => {
  it('类型修正后行为不变', () => {
    expect(parseModifications('若渴，加人参三两。')).toEqual([
      {
        condition: '渴',
        remove: [],
        add: [{ herbId: '人参', name: '人参', doseRaw: '三两' }],
        rawText: '若渴，加人参三两',
      },
    ])
    expect(parseModifications('若不加，恐不为大柴胡汤。')).toHaveLength(1)
    expect(parseModifications('上七味，以水一斗二升，煮取六升。')).toEqual([])
  })
})
