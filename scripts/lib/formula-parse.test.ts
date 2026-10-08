import { describe, expect, it } from 'vitest'
import {
  applyGeDosePropagation,
  extractFormulaBlocks,
  mergeProcessingOrphans,
  parseHerbLine,
  splitHerbLine,
} from './formula-parse.ts'

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
