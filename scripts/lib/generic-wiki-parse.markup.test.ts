import { describe, expect, it } from 'vitest'
import {
  cleanWikiBody,
  listWikiHeadings,
  splitHeadingUnits,
  stripWikiHeadingLines,
} from './generic-wiki-parse.ts'

/** data/raw/funvke.wiki 结构节选：三级章 + 四级条文 + 无四级小节的三级「產後總論」 */
const FUNVKE_SNIPPET = [
  '=== 帶下 ===',
  '==== 黃帶下（三） ====',
  '婦人有帶下而色黃者，宛如黃茶濃汁，其氣腥穢，所謂濕熱之氣也。',
  '',
  '==== 黑帶下（四） ====',
  '婦人有帶下而色黑者，甚則如黑豆汁，其氣亦腥，所謂黑帶也。',
  '=== 產後總論 ===',
  '凡病起於血氣之衰，脾胃之虛，而產後尤甚。是以丹溪先生論產後，必大補氣血為先。',
  '=== 空章 ===',
  '短。',
  '',
].join('\n')

describe('cleanWikiBody：模板只去标记、不动正文', () => {
  it('展开 {{*|…}} 小注并保留内容（data/raw/piwei-lun.wiki）', () => {
    expect(cleanWikiBody('奇而至耦者也。{{*|（陽分奇，陰分偶。）}}瀉陰火以諸風藥')).toBe(
      '奇而至耦者也。（陽分奇，陰分偶。）瀉陰火以諸風藥',
    )
  })

  it('展开 {{YL|年号}}，年号是正文（data/raw/mingyi-leian.wiki）', () => {
    expect(cleanWikiBody('　　{{YL|靖康二年}}春京師大疫有異人書一')).toBe('靖康二年春京師大疫有異人書一')
  })

  it('{{SKchar2|n}} 缺字记作 □（data/raw/waitai-miyao.wiki）', () => {
    expect(cleanWikiBody('芜青子七合{{SKchar2|26}}為末')).toBe('芜青子七合□為末')
  })

  it('删去 NoteTA 与跨行 footer/header2（data/raw/wenre-jingwei.wiki、qianjin-yaofang.wiki）', () => {
    expect(cleanWikiBody('{{NoteTA|a=zh-tw:云; zh-cn:云}}\n正文一句。').trim()).toBe('正文一句。')
    const pageBreak = [
      '前文。',
      '{{footer',
      '| previous = [[../|目录]]',
      '| next  = [[../第一|第一 諸論]]}}',
      '',
      '<!-- SUBPAGE: 備急千金要方/第一 -->',
      '',
      '{{header2',
      '| title    = [[../]]',
      '| author   = 孫思邈',
      '| section  = 第一 諸論',
      '|times=',
      '|y=|m=|d=',
      '| previous = [[../序|序]]',
      '| next     = [[../第二|第二 婦人方上]]',
      '|type= 中醫',
      '|from= 中國',
      '|notes=',
      '}}',
      '後文。',
    ].join('\n')
    const cleaned = cleanWikiBody(pageBreak)
    expect(cleaned).not.toMatch(/\{\{|\}\}|孫思邈|SUBPAGE/)
    expect(cleaned.replace(/\s+/g, '')).toBe('前文。後文。')
  })

  it('行内全角空格折成半角空格分隔药味，行首缩进删去（千金神化丸）', () => {
    const cleaned = cleanWikiBody('蓯蓉　牛膝　山藥（各六分）　續斷\n　　石南乾薑　蛇床子　')
    expect(cleaned).toBe('蓯蓉 牛膝 山藥（各六分） 續斷\n石南乾薑 蛇床子')
    expect(cleaned).not.toContain('　')
  })
})

describe('维基标题切分', () => {
  it('listWikiHeadings 识别各级标题', () => {
    const headings = listWikiHeadings(FUNVKE_SNIPPET)
    expect(headings.map((heading) => [heading.level, heading.title])).toEqual([
      [3, '帶下'],
      [4, '黃帶下（三）'],
      [4, '黑帶下（四）'],
      [3, '產後總論'],
      [3, '空章'],
    ])
    for (const heading of headings) {
      expect(FUNVKE_SNIPPET.slice(heading.start, heading.end)).toMatch(/^=+ .+ =+$/)
    }
  })

  it('splitHeadingUnits：条文正文止于下一任意级标题，不并入下一节标题', () => {
    const units = splitHeadingUnits(FUNVKE_SNIPPET, 4, 20)
    expect(units.map((unit) => [unit.title, unit.orphan])).toEqual([
      ['黃帶下（三）', false],
      ['黑帶下（四）', false],
      ['產後總論', true],
    ])
    expect(units[0]!.body).toBe('婦人有帶下而色黃者，宛如黃茶濃汁，其氣腥穢，所謂濕熱之氣也。')
    expect(units[1]!.body).toBe('婦人有帶下而色黑者，甚則如黑豆汁，其氣亦腥，所謂黑帶也。')
    for (const unit of units) expect(unit.body).not.toContain('==')
  })

  it('splitHeadingUnits：条文级标题即使正文为空也保留，保持序号', () => {
    const units = splitHeadingUnits('==== 甲 ====\n==== 乙 ====\n乙的正文足够长足够长足够长足够长足够长。', 4, 20)
    expect(units.map((unit) => unit.title)).toEqual(['甲', '乙'])
    expect(units[0]!.body).toBe('')
  })

  it('stripWikiHeadingLines 只删标题行', () => {
    const stripped = stripWikiHeadingLines(FUNVKE_SNIPPET)
    expect(stripped).not.toContain('=')
    expect(stripped).toContain('所謂黑帶也。')
    expect(stripped).toContain('短。')
  })
})
