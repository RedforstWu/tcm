import { describe, expect, it } from 'vitest'
import { buildFangshuDataset, extractClassicalFangshuBlocks, extractWaitaiBlocks } from './fangshu-formula.ts'

/** data/raw/qianjin-yaofang.wiki 第 822–846 行节选：方块后紧跟 === 灸法 ===、== 篇名 == */
const QIANJIN_SNIPPET = [
  '=== 秦椒丸 ===',
  '治婦人絕產，生來未產，蕩滌腑臟，使玉門受子精方。',
  '',
  '秦椒 天雄（各十八銖） ',
  '人參 元參 白蘞（各一兩）',
  '',
  '上四十四味為末，蜜和丸，如梧子大，酒服十丸，日再。',
  '',
  '=== 灸法 ===',
  '',
  '婦人絕子，灸然谷五十壯。在內踝前直下一寸。',
  '',
  '婦人絕嗣不生，胞門閉塞，灸關元三十壯，報之。',
  '',
  '== 妊娠惡阻第二 ==',
  '',
  '（方四首）',
  '',
  '=== 神化丸 ===',
  '',
  '治五勞七傷方。',
  '',
  '蓯蓉　牛膝　山藥（各六分）　桂心　石南乾薑　蛇床子（各三分）',
  '',
  '上七味為末，蜜丸如梧子。',
  '',
].join('\n')

/** data/raw/waitai-miyao.wiki 第 2566–2595 行节选：卷三末方 + 卷尾题 + 卷四卷首 */
const WAITAI_VOLUME_BOUNDARY = [
  '　　{{SK anchor|烏梅飲方}}',
  '　　烏梅{{SK notes|十枚}}萎蕤{{SK notes|五兩}}生薑{{SK notes|五兩}}白蜜{{SK notes|一合}}',
  '　　右藥切以水六升煮三味取二升去滓内白蜜攪調細細用下前丸多少冷煖以意斟酌縱不下丸但覺口乾渇則飲之{{SK notes|吳昇同}}',
  '',
  '　　{{SK anchor|外臺秘要方卷三}}',
  '<子部,醫家類,外臺祕要方>',
  '</poem></onlyinclude>{{SKQS footer|title=外臺秘要方|section=卷三|prev=卷二|prev_link=卷02|next=卷四|next_link=卷04|type=子}}{{PD-old}}',
  '',
  '<!-- SUBPAGE: 外臺秘要方 (四庫全書本)/卷04 -->',
  '-->{{SKQS header|title=外臺秘要方|section=卷四|prev=卷三|prev_link=卷03|next=卷五|next_link=卷05|type=子}}<onlyinclude><poem>　　欽定四庫全書',
  '　　{{SK anchor|外臺秘要方卷四}}',
  '　　唐　王燾　撰',
  '　　{{SK anchor|温病論病源二首}}',
  '　　病源經言春氣温和夏氣暑熱秋氣清涼冬氣氷寒此則四時正氣之序也',
].join('\n')

describe('extractClassicalFangshuBlocks（千金）', () => {
  const blocks = extractClassicalFangshuBlocks(QIANJIN_SNIPPET)

  it('方块止于下一个任意级标题，标题与下一小节不并入', () => {
    const qinjiao = blocks.find((block) => block.name === '秦椒丸')
    expect(qinjiao).toBeDefined()
    expect(qinjiao!.body).not.toMatch(/=|灸法|灸然谷|妊娠恶阻/)
    expect(qinjiao!.body.endsWith('日再。')).toBe(true)
  })

  it('截下的小节作为 detachedSections 保留正文；过短的篇目小注不单列', () => {
    const qinjiao = blocks.find((block) => block.name === '秦椒丸')!
    expect(qinjiao.detachedSections).toEqual([
      {
        title: '灸法',
        body: '妇人绝子，灸然谷五十壮。在内踝前直下一寸。\n\n妇人绝嗣不生，胞门闭塞，灸关元三十壮，报之。',
      },
    ])
  })

  it('全角空格分隔的药味逐一解析（神化丸），原文粘连的「石南乾薑」也切开', () => {
    const shenhua = blocks.find((block) => block.name === '神化丸')
    expect(shenhua?.herbs.map((herb) => herb.rawText)).toEqual([
      '苁蓉六分',
      '牛膝六分',
      '山药六分',
      '桂心三分',
      '石南干姜三分',
      '石南干姜三分',
      '蛇床子三分',
    ])
  })
})

describe('extractWaitaiBlocks：方块止于卷界', () => {
  it('卷尾题、分类签与下一卷卷首不并入末方', () => {
    const wumei = extractWaitaiBlocks(WAITAI_VOLUME_BOUNDARY).find((block) => block.name === '乌梅饮')
    expect(wumei).toBeDefined()
    expect(wumei!.herbs).toHaveLength(4)
    expect(wumei!.herbs.map((herb) => herb.rawText).join('')).toContain('萎蕤')
    expect(wumei!.body).toContain('但觉口干渇则饮之')
    expect(wumei!.body).not.toMatch(/外台秘要方卷|子部|王焘|病源经言/)
  })
})

describe('buildFangshuDataset：条文 id 稳定', () => {
  const RAW = [
    '=== 秦椒丸 ===',
    '治婦人絕產方。',
    '',
    '秦椒 天雄（各十八銖） 人參（各一兩）',
    '',
    '上三味為末，蜜和丸。',
    '',
    '=== 灸法 ===',
    '',
    '婦人絕子，灸然谷五十壯。在內踝前直下一寸。',
    '',
    '=== 白馬莖丸 ===',
    '',
    '白馬莖　鹿茸　石斛（各二兩）',
    '',
    '上三味為末，蜜丸。',
    '',
    '=== 神化丸 ===',
    '',
    '蓯蓉　牛膝　石南乾薑（各三分）',
    '',
    '上四味為末，蜜丸。',
  ].join('\n')

  it('appendedBlockNames 排到既有方块之后，截下小节再排其后', () => {
    const { clauses } = buildFangshuDataset({
      bookId: 'qianjin',
      raw: RAW,
      mode: 'classical',
      doseSystem: 'han',
      appendedBlockNames: ['白马茎丸'],
    })
    expect(clauses.map((clause) => [clause.id, clause.heading, clause.formulaIds.length])).toEqual([
      ['qianjin-001-0001', '秦椒丸', 1],
      ['qianjin-001-0002', '神化丸', 1],
      ['qianjin-001-0003', '白马茎丸', 1],
      ['qianjin-001-0004', '灸法', 0],
    ])
    expect(clauses[3]!.text).toBe('妇人绝子，灸然谷五十壮。在内踝前直下一寸。')
  })

  it('appendedBlockNames 未命中时抛错，防止配置过期', () => {
    expect(() =>
      buildFangshuDataset({
        bookId: 'qianjin',
        raw: RAW,
        mode: 'classical',
        doseSystem: 'han',
        appendedBlockNames: ['不存在丸'],
      }),
    ).toThrow(/不存在丸/)
  })
})
