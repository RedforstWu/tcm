import { describe, expect, it } from 'vitest'
import { buildHerbLexicon } from './herb-lexicon.ts'
import {
  extractAnnotationFormulaName,
  extractShishiFormulaBlocks,
  parseShishiHerbRun,
} from './shishi-formula.ts'

const lexicon = buildHerbLexicon()

describe('extractAnnotationFormulaName', () => {
  it('reads formula name from 批 annotation', () => {
    expect(extractAnnotationFormulaName('补气消痰饮。')).toBe('补气消痰饮')
    expect(extractAnnotationFormulaName('安寐丹。妙。')).toBe('安寐丹')
    expect(extractAnnotationFormulaName('祛狂至神丹方。妙。')).toBe('祛狂至神丹')
  })

  it('ignores commentary annotations', () => {
    expect(extractAnnotationFormulaName('何言之当也。')).toBeUndefined()
    expect(extractAnnotationFormulaName('天师曰∶妙绝。')).toBeUndefined()
  })
})

describe('parseShishiHerbRun', () => {
  it('parses comma separated herb-dose list', () => {
    const herbs = parseShishiHerbRun('人参三钱，白术五钱，陈皮五分', lexicon)
    expect(herbs.map((herb) => herb.name)).toEqual(['人参', '白术', '陈皮'])
    expect(herbs[2]?.doseQian).toBe(0.5)
  })

  it('splits herbs separated by 顿号 with own doses', () => {
    const herbs = parseShishiHerbRun('人参一两、白术三两，附子一钱', lexicon)
    expect(herbs.map((herb) => `${herb.name}${herb.doseRaw}`)).toEqual([
      '人参一两',
      '白术三两',
      '附子一钱',
    ])
  })

  it('drops narrative fragments and other-formula references', () => {
    const herbs = parseShishiHerbRun('独参汤三两，加黄连三钱，煎汤一分，石膏一两，雷丸三钱', lexicon)
    expect(herbs.map((herb) => herb.name)).toEqual(['黄连', '石膏', '雷丸'])
  })

  it('expands shared 各 dose', () => {
    const herbs = parseShishiHerbRun('人参、白术各三钱，甘草一钱', lexicon)
    expect(herbs.map((herb) => `${herb.name}${herb.doseRaw}`)).toEqual([
      '人参三钱',
      '白术三钱',
      '甘草一钱',
    ])
  })
})

describe('extractShishiFormulaBlocks', () => {
  const body = `天师曰∶肥治者，治肥人之病也。方用人参三两，白术五两，茯苓二两，各为末，蜜为丸。每日白滚水送下五钱，（〔批〕火土两培丹。）

此方之佳，全在肉桂之妙。

张公曰∶妙。若有人不肯服丸药，当用煎方。予定一方，用人参三钱，白术五钱，半夏一钱，水煎服。（〔批〕补气消痰饮。）此方肥人可常用也。`

  it('names formulas from following 批 annotation', () => {
    const blocks = extractShishiFormulaBlocks(body, { lexicon })
    expect(blocks.map((block) => block.name)).toEqual(['火土两培丹', '补气消痰饮'])
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual(['人参', '白术', '茯苓'])
    expect(blocks[0]!.preparation).toContain('蜜为丸')
    expect(blocks[1]!.role).toBe('alternate')
    expect(blocks[1]!.fangjie).toContain('肥人可常用')
  })

  it('does not pick herbs from inside 批 commentary', () => {
    const text = `方用白芍一两，柴胡一钱，水煎服。（〔批〕雷公曰∶予更有方，用熟地三两，山萸一两，水煎服。）`
    const blocks = extractShishiFormulaBlocks(text, { lexicon, anonymousPrefix: '厥治法' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.anonymous).toBe(true)
    expect(blocks[0]!.name).toBe('厥治法·方1')
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual(['白芍', '柴胡'])
  })

  it('keeps later formulas after an unclosed 批 annotation', () => {
    const text = `方用附子一个，白术四两，人参三两救之。（〔批〕定吐至神丹。雷公曰∶方用人参一两，黄连三钱，各为末。

大泻者，方当用大黄一两，人参二两，水煎服。

张公曰∶方用人参一两、白术三两，附子一钱，水煎服。（〔批〕止泻定痛丹。）此方即五苓散加人参者也。`
    const blocks = extractShishiFormulaBlocks(text, { lexicon, anonymousPrefix: '霸治法' })
    expect(blocks.map((block) => block.name)).toEqual(['定吐至神丹', '大泻方', '止泻定痛丹'])
    expect(blocks[2]!.herbs.map((herb) => herb.name)).toEqual(['人参', '白术', '附子'])
  })

  it('names anonymous formulas from adjacent or paragraph topic', () => {
    const text = `华君曰∶传予之方不然也。痈疽方∶用金银花三两，生甘草三钱，水煎服。

至于中暑之病，亦阳火邪炽也。法用青蒿五钱，石膏五钱，水煎服。

更有一方∶用人参一两，白术一两，水煎服。`
    const blocks = extractShishiFormulaBlocks(text, { lexicon, anonymousPrefix: '外治法·第2则' })
    expect(blocks.map((block) => block.name)).toEqual(['痈疽方', '中暑方', '外治法·第2则·方3'])
    expect(blocks.every((block) => block.anonymous)).toBe(true)
  })

  it('reads herb list introduced by 方∶ without 用', () => {
    const text = `治小儿疟疾方∶柴胡六分，白术一钱，茯苓一钱。

治肾方者，精滑梦遗。方用熟地一两，山茱萸五钱，水煎服。`
    const blocks = extractShishiFormulaBlocks(text, { lexicon, anonymousPrefix: '儿科' })
    expect(blocks.map((block) => block.name)).toEqual(['小儿疟疾方', '儿科·方2'])
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual(['柴胡', '白术', '茯苓'])
  })

  it('numbers repeated topic names within one clause', () => {
    const text = `大泻者，方当用大黄一两，人参二两，水煎服。

大泻者，又方用人参一两，白术三两，水煎服。`
    const blocks = extractShishiFormulaBlocks(text, { lexicon })
    expect(blocks.map((block) => block.name)).toEqual(['大泻方1', '大泻方2'])
  })

  it('returns empty when no herb-dose list exists', () => {
    expect(extractShishiFormulaBlocks('天师曰∶此论其理，不在方药。', { lexicon })).toEqual([])
  })

  it('names formulas from 方名 after first sentence period', () => {
    const text =
      '方用白芍、当归各三钱，茯苓五钱，柴胡五分，甘草一钱，白芥子一钱，丹皮二钱，枣仁一钱，水煎服。方名静待汤。此方之妙，全无惊张之气。'
    const blocks = extractShishiFormulaBlocks(text, { lexicon })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.name).toBe('静待汤')
    expect(blocks[0]!.herbs.map((herb) => herb.name)).toEqual(
      expect.arrayContaining(['白芍', '当归', '茯苓', '柴胡']),
    )
  })
})
