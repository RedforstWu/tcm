import { describe, expect, it } from 'vitest'
import {
  extractChenfuFormulaBlocks,
  isJunkChenfuFormulaName,
  normalizeChenfuFormulaName,
  parseChenfuHerbLine,
  splitChenfuHerbLine,
} from './chenfu-formula.ts'
import { buildHerbLexicon } from './herb-lexicon.ts'

const lexicon = buildHerbLexicon()

describe('splitChenfuHerbLine', () => {
  it('splits paren-glued herbs', () => {
    const tokens = splitChenfuHerbLine(
      '石膏（一两）知母（二钱）麦冬（二两）',
      lexicon,
    )
    expect(tokens.length).toBeGreaterThanOrEqual(3)
    expect(tokens[0]).toContain('石膏')
  })

  it('splits shared 各 dose', () => {
    const tokens = splitChenfuHerbLine('甘草人参柴胡栀子（各一钱）', lexicon)
    expect(tokens.length).toBe(4)
    expect(tokens.every((t) => t.includes('一钱'))).toBe(true)
  })

  it('drops leading formula label and colon', () => {
    const tokens = splitChenfuHerbLine('补中益气汤∶人参（三钱）当归（二钱）', lexicon)
    expect(tokens).toEqual(['人参（三钱）', '当归（二钱）'])
    expect(splitChenfuHerbLine('∶人参（三两）', lexicon)).toEqual(['人参（三两）'])
  })

  it('applies 各 dose to every herb since the previous dosed herb', () => {
    const tokens = splitChenfuHerbLine('当归（ 叁钱） 人参 柴胡 陈皮 甘草（ 各壹钱）', lexicon)
    expect(tokens).toEqual(['当归（ 叁钱）', '人参（壹钱）', '柴胡（壹钱）', '陈皮（壹钱）', '甘草（壹钱）'])
  })

  it('treats square brackets as dose parentheses', () => {
    const herbNames = parseChenfuHerbLine('荆芥、防风、甘草［各等分]', lexicon).map(
      (herb) => `${herb.name}:${herb.doseRaw}`,
    )
    expect(herbNames).toEqual(['荆芥:等分', '防风:等分', '甘草:等分'])
  })

  it('rejoins herb names written one character per 顿号', () => {
    const tokens = splitChenfuHerbLine('荆芥、防风、柴、胡、黄、芩、半、夏', lexicon)
    expect(tokens).toEqual(['荆芥', '防风', '柴胡', '黄芩', '半夏'])
  })

  it('drops undosed narrative fragments but keeps undosed herbs', () => {
    const herbNames = parseChenfuHerbLine('人参（三两）附子（三分）煎汤灌之而人不死矣', lexicon).map(
      (herb) => herb.name,
    )
    expect(herbNames).toEqual(['人参', '附子'])
    const undosedHerbNames = parseChenfuHerbLine('茯神 广木香 鳗鱼', lexicon).map((herb) => herb.name)
    expect(undosedHerbNames).toEqual(['茯神', '木香', '鳗鱼'])
  })

  it('stops at inline pill preparation text', () => {
    const tokens = splitChenfuHerbLine('杜仲（六两）肉桂（六两）各为细末，蜜为丸，每日早晚服', lexicon)
    expect(tokens).toEqual(['杜仲（六两）', '肉桂（六两）'])
  })

  it('stops at inline preparation text', () => {
    const tokens = splitChenfuHerbLine(
      '茯苓（五钱）桂枝（三分）水煎服。一剂而头痛除',
      lexicon,
    )
    expect(tokens).toEqual(['茯苓（五钱）', '桂枝（三分）'])
  })
})

describe('normalizeChenfuFormulaName', () => {
  it('strips 此症用 / 此病用 / 用 lead words', () => {
    expect(normalizeChenfuFormulaName('此症用济阳汤')).toBe('济阳汤')
    expect(normalizeChenfuFormulaName('此病用舒经汤')).toBe('舒经汤')
    expect(normalizeChenfuFormulaName('此症知柏茯苓汤')).toBe('知柏茯苓汤')
    expect(normalizeChenfuFormulaName('用通肝散')).toBe('通肝散')
    expect(normalizeChenfuFormulaName('此方即四物汤')).toBe('四物汤')
    expect(normalizeChenfuFormulaName('此疟用首攻汤')).toBe('首攻汤')
  })

  it('keeps real names starting with 宜', () => {
    expect(normalizeChenfuFormulaName('宜春汤')).toBe('宜春汤')
    expect(normalizeChenfuFormulaName('宜男化育丹')).toBe('宜男化育丹')
  })

  it('strips 亦可用 lead words', () => {
    expect(normalizeChenfuFormulaName('亦可用加味六君子汤')).toBe('加味六君子汤')
    expect(normalizeChenfuFormulaName('此症亦可用三奇汤')).toBe('三奇汤')
  })
})

describe('parseChenfuHerbLine', () => {
  it('parses wan dai tang herbs', () => {
    const herbs = parseChenfuHerbLine('白术（一两，土炒）', lexicon)
    expect(herbs[0]?.name).toBe('白术')
    expect(herbs[0]?.doseQian).toBe(10)
  })

  it('excludes punctuation-only and solvent tokens', () => {
    const herbs = parseChenfuHerbLine('∶ 人参（三两） 水（半）', lexicon)
    expect(herbs.map((herb) => herb.name)).toEqual(['人参'])
  })
})

describe('extractChenfuFormulaBlocks', () => {
  it('parses wan dai tang block', () => {
    const body = `妇人有终年累月下流白物。治法宜大补脾胃之气。方用完带汤。
白术（一两，土炒）　　　山药（一两，炒）
人参（二钱）　　　　　　白芍（五钱，酒炒）
车前子（三钱，酒炒）　　苍术（三钱，製）
甘草（一钱）　　　　　　陈皮（五分）
黑芥穗（五分）　　　　　柴胡（六分）
水煎服。二剂轻，四剂止。
此方脾、胃、肝三经同治之法，寓补于散之中，寄消于升之内。`

    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0]!.name).toContain('完带')
    expect(blocks[0]!.herbs.length).toBeGreaterThanOrEqual(8)
    expect(blocks[0]!.fangjie.length).toBeGreaterThan(10)
  })

  it('parses bianzheng alternate formula', () => {
    const body = `冬月伤寒，发热头痛。
方用∶
石膏（一两）知母（二钱）麦冬（二两）竹叶（二百片）茯苓（三钱）甘草（一钱）人参（三钱）柴胡（一钱）栀子（一钱）水煎服。
此即白虎汤变方，用石膏、知母以泻其阳明之火邪。
或惧前方太重，则清肃汤亦可用也。
石膏（五钱）知母（一钱）麦冬（一两）甘草人参柴胡栀子（各一钱）独活半夏（各五分）水煎服。`

    const blocks = extractChenfuFormulaBlocks(body, {
      lexicon,
      anonymousPrefix: '伤寒门·第1则',
    })
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0]!.derivedFrom.some((d) => d.name.includes('白虎'))).toBe(true)
  })

  it('keeps colon and water out of same-line herbs', () => {
    const body = `方用救汗回生汤∶人参（三两）当归（二两）柴胡（一钱）水煎服。一剂而汗收`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('救汗回生汤')
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual(['人参', '当归', '柴胡'])
  })

  it('splits alternate formula introduced by 亦可治 / 亦效 and same-line herbs', () => {
    const body = `方用六味地黄汤∶熟地（二两）山茱萸（一两）茯苓（八钱）水煎服。一剂昏晕苏。此方非救脱之药也，然肾水枯而肾始绝，大滋其肾水，枯槁之时得滂沱之泽，则沟洫之间，无非生意，是补水正所以救肾之绝，岂大肠得水而反不能救其脱乎。
此症用两援汤亦可治。
熟地（二两）当归人参白术（各一两）肉桂（二钱）水煎服。
定乱汤亦效。
人参（一两）山药（一两）水煎服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks.map((block) => block.name)).toEqual(['六味地黄汤', '两援汤', '定乱汤'])
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual(['熟地黄', '山茱萸', '茯苓'])
    expect(blocks[1]!.herbs.map((herb) => `${herb.name}${herb.doseRaw}`)).toEqual([
      '熟地黄二两',
      '当归一两',
      '人参一两',
      '白术一两',
      '肉桂二钱',
    ])
    expect(blocks[2]!.role).toBe('alternate')
  })

  it('does not treat narrative after formula name as herbs', () => {
    const body = `方用六味地黄汤加味治之。\n熟地（一两）山茱萸（五钱）水煎服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('六味地黄汤')
    const herbNames = blocks[0]!.herbs.map((herb) => herb.name)
    expect(herbNames).not.toContain('加味')
    expect(herbNames).not.toContain('治之')
  })
  it('links 方用X汤。 to next-line 用∶ herb list', () => {
    const body = `方用急救阴阳汤。
用∶人参（二两）黄（三两）当归（一两）熟地（二两）甘草（三钱）白术（二两）水煎服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('急救阴阳汤')
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual([
      '人参',
      '黄芪',
      '当归',
      '熟地黄',
      '甘草',
      '白术',
    ])
  })

  it('parses 温正汤 alternate with herbs', () => {
    const body = `温正汤亦可用。
人参（五钱）黄（一两）当归（五钱）柴胡（一钱）甘草（五分）神曲（一钱）桂枝（三分）水煎服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('温正汤')
    expect(blocks[0]!.herbs.length).toBeGreaterThanOrEqual(6)
  })

  it('parses 顺气和血汤 alternate with herbs', () => {
    const body = `此症用顺气和血汤亦大佳。
当归（一两）川芎（三钱）白芍（五钱）熟地（一两）香附（一钱）柴胡（一钱）陈皮（一钱）甘草（一钱）茯苓（二钱）白术（三钱）水煎服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('顺气和血汤')
    expect(blocks[0]!.herbs.length).toBe(10)
  })

  it('drops junk alternate intro without herbs before next case', () => {
    const body = `此症亦可用加味六君子汤治之。
人有口渴饮水忽然呃逆者，非水气之故。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks.every((block) => block.name !== '亦可用加味六君子汤')).toBe(true)
    expect(blocks.every((block) => block.herbs.length > 0 || !block.name.includes('六君子'))).toBe(
      true,
    )
  })

  it('parses long same-line herbs ending with 二剂而愈', () => {
    const body = `饮鸩酒者，倘眼未闭，虽三日内，用药尚可活，方用消鸩汤∶
金银花（八两，煎汤取汁二碗）用∶白矾（三钱）寒水石（三钱）菖蒲（二钱）天花粉（三钱）麦冬（五钱）再煎一碗灌之。一时辰后，眼不上视，口能出言。再用前一半，如前法煎饮，二剂而愈，断不死也。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('消鸩汤')
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual([
      '金银花',
      '白矾',
      '寒水石',
      '石菖蒲',
      '天花粉',
      '麦冬',
    ])
  })

  it('splits mid-line 方用 next formula and keeps its herbs', () => {
    const body = `方用散结定疼汤。
当归（一两）川芎（三钱）水煎服。一剂而疼轻。何碍之有。方用肠宁汤。
当归（一两，酒洗）　　　熟地（一两，九蒸）
人参（三钱）　　　　　　麦冬（三钱，去心）
水煎服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks.map((block) => block.name)).toEqual(['散结定疼汤', '肠宁汤'])
    expect(blocks[1]!.herbs.length).toBeGreaterThanOrEqual(4)
  })

  it('parses ◎ named formula headers with dose lines', () => {
    const body = `服加味芎归汤，良久即下。
◎加味芎归汤：
小川芎（一两）　　　　当归（一两）
败龟版（一个，酒炙）　妇人发灰（一握）
水一锺，煎七分服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('加味芎归汤')
    expect(blocks[0]!.herbs.length).toBeGreaterThanOrEqual(3)
  })

  it('parses 方名助仙丹 with following herbs', () => {
    const body = `又不可不立一疗救之方以辅之，方名助仙丹。
白茯苓（五钱）　　　　　陈皮（五钱）
白术（三钱，土炒）　　　白芍（三钱，酒炒）
河水煎服。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('助仙丹')
    expect(blocks[0]!.herbs.length).toBeGreaterThanOrEqual(4)
  })

  it('strips 再服 lead from alternate formula name', () => {
    expect(normalizeChenfuFormulaName('再服调正汤')).toBe('调正汤')
    const body = `再服调正汤治之。
白术（五钱）　　　苍术（五钱）
茯苓（三钱）　　　陈皮（一钱）
水煎。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks[0]!.name).toBe('调正汤')
    expect(blocks[0]!.herbs.length).toBeGreaterThanOrEqual(4)
  })

  it('splits narrative line ending with 宜用 next formula', () => {
    const body = `产后感风作痛，宜用祛风定痛汤。
川芎（一钱）当归（三钱）水煎服。
治当补心养肾，外以药熏洗，宜用十全阴疳散。
川芎　　　　　　　　　　当归
白芍　　　　　　　　　　地榆
甘草（各等分）
水五碗，煎二碗，去渣薰。
一方，用蒲黄一升。`
    const blocks = extractChenfuFormulaBlocks(body, { lexicon })
    expect(blocks.map((block) => block.name)).toEqual(['祛风定痛汤', '十全阴疳散'])
    expect(blocks[1]!.herbs.map((herb) => herb.name)).toEqual([
      '川芎',
      '当归',
      '白芍',
      '地榆',
      '甘草',
    ])
  })
})

describe('isJunkChenfuFormulaName', () => {
  it('rejects garbage formula names', () => {
    expect(isJunkChenfuFormulaName('乎尽散')).toBe(true)
    expect(isJunkChenfuFormulaName('麻黄之汤')).toBe(true)
    expect(isJunkChenfuFormulaName('蜜为丸')).toBe(true)
    expect(isJunkChenfuFormulaName('亦可用加味六君子汤')).toBe(true)
    expect(isJunkChenfuFormulaName('荆芥以助石膏')).toBe(true)
    expect(isJunkChenfuFormulaName('急救阴阳汤')).toBe(false)
  })
})

