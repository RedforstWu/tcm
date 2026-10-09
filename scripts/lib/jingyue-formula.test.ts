import { describe, expect, it } from 'vitest'
import { extractJingyueFangzhenBlocks, isJingyueSingleHerbFormula } from './jingyue-formula.ts'

const VOLUME_MARK = '<!-- SUBPAGE: 景岳全书/卷61 -->'

function blockNames(lines: string[]): Map<string, string[]> {
  const blocks = extractJingyueFangzhenBlocks([VOLUME_MARK, ...lines].join('\n'))
  return new Map(blocks.map((block) => [block.name, block.herbs.map((herb) => herb.name)]))
}

describe('景岳单味方门槛', () => {
  it('一母丸 / 知母丸：药列只有知母、其后另起「右…」制法，按单味方收录', () => {
    const blocks = blockNames([
      '　　{{SK anchor|一母丸}}{{SK notes|三七}}　一名知母丸○治妊娠血虚頓仆胎動不安或欲墮産',
      '　　{{SK anchor|知母}}{{SK notes|炒爲末}}',
      '　　右搗棗肉爲丸彈子大每服一丸人參湯嚼送',
    ])
    expect(blocks.get('一母丸')).toEqual(['知母'])
    expect(blocks.get('知母丸')).toEqual(['知母'])
  })

  it('只解析出一味、无单味标志、无剂量且后面不是制法时仍丢弃', () => {
    const blocks = blockNames([
      '　　{{SK anchor|截断汤}}{{SK notes|三九}}　治某证',
      '　　{{SK anchor|知母}}{{SK notes|炒}}　此下文字残缺不全无从考校',
    ])
    expect(blocks.has('截断汤')).toBe(false)
  })

  it('isJingyueSingleHerbFormula 的三种放行条件与反例', () => {
    const zhimu = { herbId: '知母', name: '知母', rawText: '知母（炒为末）', doseRaw: '' }
    expect(isJingyueSingleHerbFormula(zhimu, '知母（炒为末）  \n 右捣枣肉为丸', '')).toBe(true)
    expect(isJingyueSingleHerbFormula(zhimu, '知母（炒为末） 右一味为末', '')).toBe(true)
    expect(isJingyueSingleHerbFormula({ ...zhimu, doseRaw: '二钱' }, '知母（二钱） 黄芩', '')).toBe(true)
    // 药列后还有别的文字（多半是截断的药列）
    expect(isJingyueSingleHerbFormula(zhimu, '知母（炒为末） 黄芩 \n 右为末', '')).toBe(false)
    // 「荞麦一味」不能为误取到的「臙脂汁」作证
    const yanzhi = { herbId: '臙脂汁', name: '臙脂汁', rawText: '臙脂汁', doseRaw: '' }
    expect(isJingyueSingleHerbFormula(yanzhi, '荞麦一味磨取细面 臙脂汁 先用升麻一味煎浓汤', '')).toBe(false)
  })
})
