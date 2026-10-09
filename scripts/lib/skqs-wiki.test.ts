import { describe, expect, it } from 'vitest'
import { chunkSkqsBody, stripSkqsVolumeTitleLine } from './skqs-wiki.ts'

/** data/raw/rumen-shiqin.wiki 卷十卷首（第 930 行起），正文行取自原文 */
const RUMEN_JUAN10_HEAD = [
  '　　欽定四庫全書',
  '　　儒門事親卷十　　　　　金　張從正　撰',
  '',
  '外有風寒暑濕屬天之四令無形也',
  '內有飢飽勞逸屬天之四令有形也',
  '一者始因氣動而內有所成者謂積聚癥瘕瘤氣癭起結核狂瞀癎疏曰癥堅也積也瘕氣血也',
  '二者始因氣動而外有所成者謂癰腫瘡瘍疥癬疽痔掉瘈浮腫目赤熛痓胕腫痛癢之類是也',
  '',
].join('\n')

describe('stripSkqsVolumeTitleLine（输入为繁简转换后的行）', () => {
  it('整行丢弃丛书名、卷题、撰者行、分类签', () => {
    expect(stripSkqsVolumeTitleLine('钦定四库全书')).toBeNull()
    expect(stripSkqsVolumeTitleLine('钦定四库金书')).toBeNull()
    expect(stripSkqsVolumeTitleLine('钦定四库全书儒门事亲卷十金张从正撰')).toBeNull()
    expect(stripSkqsVolumeTitleLine('续名医类案巻十二')).toBeNull()
    expect(stripSkqsVolumeTitleLine('钱塘魏之琇撰')).toBeNull()
    expect(stripSkqsVolumeTitleLine('<子部,医家类,景岳全书>')).toBeNull()
  })

  it('卷题后紧跟的篇名保留', () => {
    expect(stripSkqsVolumeTitleLine('景岳全书卷七明张介賔撰伤寒')).toBe('伤寒')
  })

  it('正文行原样返回', () => {
    expect(stripSkqsVolumeTitleLine('一者始因气动而内有所成者')).toBe('一者始因气动而内有所成者')
    expect(stripSkqsVolumeTitleLine('儒门事亲之法')).toBe('儒门事亲之法')
  })
})

describe('chunkSkqsBody：去卷题且保持原分段', () => {
  it('儒门事亲卷十：卷首题名不进正文，段界与旧版一致', () => {
    const blocks = chunkSkqsBody(RUMEN_JUAN10_HEAD).split('\n\n')
    expect(blocks).toEqual([
      '外有风寒暑湿属天之四令无形也内有饥饱劳逸属天之四令有形也',
      '一者始因气动而内有所成者谓积聚症瘕瘤气瘿起结核狂瞀癎疏曰症坚也积也瘕气血也二者始因气动而外有所成者谓痈肿疮疡疥癣疽痔掉瘈浮肿目赤熛痓胕肿痛痒之类是也',
    ])
  })

  it('续名医类案卷六十末段：去卷尾题后短正文仍保留（data/raw/xumingyi-leian.wiki 第 7346 行）', () => {
    const body = chunkSkqsBody(
      '{{SK anchor|破傷風}}\n　　按衛生寳鑑以此方兼治狂犬所傷并諸犬咬神効\n\n　　續名醫類案卷六十\n',
    )
    expect(body).toBe('【破伤风】按卫生寳鉴以此方兼治狂犬所伤并诸犬咬神効')
  })

  it('只有题名的块整块丢弃', () => {
    expect(chunkSkqsBody('　　欽定四庫全書\n　　景岳全書卷十九\n<子部,醫家類,景岳全書>\n')).toBe('')
  })
})
